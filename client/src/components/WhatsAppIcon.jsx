import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';

export default function WhatsAppIcon({ size = 16, style, ...props }) {
    return (
        <FontAwesomeIcon
            icon={faWhatsapp}
            style={{ fontSize: typeof size === 'number' ? `${size}px` : size, ...(style || {}) }}
            {...props}
        />
    );
}
