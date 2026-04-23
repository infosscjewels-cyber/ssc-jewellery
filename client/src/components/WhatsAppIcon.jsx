import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';

export default function WhatsAppIcon({ size = 16, style, ...props }) {
    const normalizedSize = typeof size === 'number' ? `${size}px` : size;
    return (
        <FontAwesomeIcon
            icon={faWhatsapp}
            style={{
                fontSize: normalizedSize,
                width: normalizedSize,
                height: normalizedSize,
                lineHeight: 1,
                display: 'block',
                verticalAlign: 'middle',
                ...(style || {})
            }}
            {...props}
        />
    );
}
