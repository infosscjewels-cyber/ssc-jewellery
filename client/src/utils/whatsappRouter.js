import { buildWhatsAppChatLink } from './publicContact';

export const SECONDARY_SUPPORT_WHATSAPP_NUMBER = '9500941350';

const STORAGE_KEY = 'ssc_storefront_whatsapp_assignment';

const sanitizeWhatsappNumber = (value = '') => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 14) return '';
  return digits;
};

const getStorefrontWhatsappNumbers = (companyInfo = null) => {
  const candidates = [
    companyInfo?.whatsappNumber,
    SECONDARY_SUPPORT_WHATSAPP_NUMBER
  ];

  return [...new Set(candidates.map(sanitizeWhatsappNumber).filter(Boolean))];
};

const buildPoolSignature = (numbers = []) => numbers.join('|');

const readAssignment = () => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeAssignment = (payload) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures and fall back to ephemeral routing.
  }
};

const pickAssignedNumber = (numbers = []) => {
  if (!numbers.length) return '';
  if (numbers.length === 1) return numbers[0];
  return numbers[Math.floor(Math.random() * numbers.length)] || numbers[0];
};

export const resolveAssignedWhatsappNumber = (companyInfo = null) => {
  const numbers = getStorefrontWhatsappNumbers(companyInfo);
  if (!numbers.length) return '';

  const poolSignature = buildPoolSignature(numbers);
  const assignment = readAssignment();
  const assignedNumber = sanitizeWhatsappNumber(assignment?.number);

  if (assignedNumber && assignment?.poolSignature === poolSignature && numbers.includes(assignedNumber)) {
    return assignedNumber;
  }

  const nextNumber = pickAssignedNumber(numbers);
  if (!nextNumber) return '';

  writeAssignment({
    number: nextNumber,
    poolSignature,
    assignedAt: Date.now()
  });

  return nextNumber;
};

export const buildAssignedWhatsAppLink = ({ companyInfo = null, text = '' } = {}) => {
  const assignedNumber = resolveAssignedWhatsappNumber(companyInfo);
  if (!assignedNumber) return '';
  return buildWhatsAppChatLink({ number: assignedNumber, text });
};

export const clearAssignedWhatsappNumber = () => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

export { getStorefrontWhatsappNumbers };
