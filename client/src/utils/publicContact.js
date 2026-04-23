import { getBaseUrl } from '../seo/helpers';

const cleanPhone = (value = '') => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

export const getWebsiteUrl = () => getBaseUrl() || '/';

export const getWhatsappNumber = (preferred = '') => (
  cleanPhone(preferred || import.meta.env.VITE_WHATSAPP_NUMBER || '')
);

export const buildWhatsAppChatLink = ({ number = '', text = '' } = {}) => {
  const resolvedNumber = getWhatsappNumber(number);
  if (!resolvedNumber) return '';
  const encodedText = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${resolvedNumber}${encodedText}`;
};

export const buildWhatsAppShareLink = ({ text = '' } = {}) => {
  return `https://wa.me/?text=${encodeURIComponent(String(text || ''))}`;
};
