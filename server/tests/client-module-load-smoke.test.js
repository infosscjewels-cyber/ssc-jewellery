const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const espree = require(require.resolve('espree', { paths: [path.resolve(__dirname, '../../client')] }));

const CLIENT_SRC_ROOT = path.resolve(__dirname, '../../client/src');

const walkFiles = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(absolute, out);
            continue;
        }
        if (/\.(js|jsx)$/.test(entry.name)) {
            out.push(absolute);
        }
    }
    return out;
};

const traverseAst = (node, visit) => {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            value.forEach((child) => traverseAst(child, visit));
        } else if (value && typeof value.type === 'string') {
            traverseAst(value, visit);
        }
    }
};

const isHookCallExpression = (node) => (
    node
    && node.type === 'CallExpression'
    && node.callee
    && node.callee.type === 'Identifier'
    && /^use[A-Z]/.test(node.callee.name)
);

const collectTopLevelTdZHookDeps = (ast, filePath) => {
    const issues = [];

    traverseAst(ast, (node) => {
        if (!['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return;
        if (!node.body || node.body.type !== 'BlockStatement') return;

        const statements = node.body.body || [];
        const constDeclarations = new Map();

        statements.forEach((statement, index) => {
            if (statement.type !== 'VariableDeclaration') return;
            if (!['const', 'let'].includes(statement.kind)) return;
            for (const declarator of statement.declarations || []) {
                if (declarator.id?.type !== 'Identifier') continue;
                if (!constDeclarations.has(declarator.id.name)) {
                    constDeclarations.set(declarator.id.name, {
                        index,
                        line: statement.loc?.start?.line || null
                    });
                }
            }
        });

        statements.forEach((statement, index) => {
            const hookCalls = [];
            if (statement.type === 'ExpressionStatement' && isHookCallExpression(statement.expression)) {
                hookCalls.push(statement.expression);
            }
            if (statement.type === 'VariableDeclaration') {
                for (const declarator of statement.declarations || []) {
                    if (isHookCallExpression(declarator.init)) {
                        hookCalls.push(declarator.init);
                    }
                }
            }

            for (const hookCall of hookCalls) {
                if (hookCall.arguments.length < 2) continue;
                const deps = hookCall.arguments[1];
                if (!deps || deps.type !== 'ArrayExpression') continue;

                for (const dep of deps.elements || []) {
                    if (!dep || dep.type !== 'Identifier') continue;
                    const declaration = constDeclarations.get(dep.name);
                    if (!declaration) continue;
                    if (declaration.index <= index) continue;

                    issues.push({
                        file: path.relative(path.resolve(__dirname, '../..'), filePath),
                        hook: hookCall.callee.name,
                        hookLine: hookCall.loc?.start?.line || null,
                        dependency: dep.name,
                        declarationLine: declaration.line
                    });
                }
            }
        });
    });

    return issues;
};

test('client modules do not reference later const/let callbacks in hook dependency arrays', () => {
    const files = walkFiles(CLIENT_SRC_ROOT);
    const issues = [];

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf8');
        const ast = espree.parse(source, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            ecmaFeatures: { jsx: true },
            loc: true
        });
        issues.push(...collectTopLevelTdZHookDeps(ast, filePath));
    }

    assert.deepEqual(
        issues,
        [],
        `Hook dependency TDZ issues found:\n${issues.map((issue) => `${issue.file}:${issue.hookLine} uses ${issue.dependency} before declaration at line ${issue.declarationLine}`).join('\n')}`
    );
});
