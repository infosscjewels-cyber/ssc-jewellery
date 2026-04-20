const ExcelJS = require('exceljs');

const HEADER_FILL = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' }
};

const normalizeCellValue = (value) => (
    value === null || value === undefined ? '' : value
);

const estimateColumnWidths = ({ columns = [], prefaceRows = [], dataRows = [] } = {}) => {
    const widths = columns.map((label) => Math.max(12, String(label || '').length + 2));
    const inspectRows = [...prefaceRows, ...dataRows];
    inspectRows.forEach((row) => {
        if (!Array.isArray(row)) return;
        row.forEach((cell, index) => {
            const size = String(normalizeCellValue(cell)).length + 2;
            widths[index] = Math.min(48, Math.max(widths[index] || 12, size));
        });
    });
    return widths;
};

const buildWorkbookBuffer = async ({
    sheetName = 'Report',
    columns = [],
    rows = [],
    prefaceRows = []
} = {}) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SSC Jewellery';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(String(sheetName || 'Report').slice(0, 31));

    (Array.isArray(prefaceRows) ? prefaceRows : []).forEach((row) => {
        worksheet.addRow(Array.isArray(row) ? row.map(normalizeCellValue) : [normalizeCellValue(row)]);
    });

    const headerRow = worksheet.addRow((Array.isArray(columns) ? columns : []).map(normalizeCellValue));
    headerRow.font = { bold: true };
    headerRow.fill = HEADER_FILL;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        worksheet.addRow((Array.isArray(row) ? row : [row]).map(normalizeCellValue));
    });

    const headerRowNumber = Math.max(1, worksheet.rowCount - (Array.isArray(rows) ? rows.length : 0));
    const widths = estimateColumnWidths({ columns, prefaceRows, dataRows: rows });
    worksheet.columns = widths.map((width) => ({ width }));
    worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
    if (columns.length > 0) {
        worksheet.autoFilter = {
            from: { row: headerRowNumber, column: 1 },
            to: { row: headerRowNumber, column: columns.length }
        };
    }

    return workbook.xlsx.writeBuffer();
};

module.exports = {
    buildWorkbookBuffer
};
