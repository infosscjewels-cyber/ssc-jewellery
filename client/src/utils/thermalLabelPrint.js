const PRINTER_STORAGE_KEY = 'thermal_label_printer_v1';
const PRINTER_SERVICE_UUIDS = [0xffe0, 0x18f0, 0x180a, 0x180f];
const WRITE_CHUNK_BYTES = 180;
const LABEL_MAX_ADDRESS_LINES = 6;
const LABEL_MAX_LINE_CHARS = 30;
const USB_PRINTER_FILTERS = [{ classCode: 0x07 }];
const USB_REQUEST_TIMEOUT_MS = 10_000;

const safeText = (value = '') => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();

const splitTextLines = (value = '', maxChars = LABEL_MAX_LINE_CHARS, maxLines = LABEL_MAX_ADDRESS_LINES) => {
    const text = safeText(value);
    if (!text) return [];
    const tokens = text.split(/[,\n]+/).map((part) => safeText(part)).filter(Boolean);
    const lines = [];
    let current = '';
    const pushLine = (line = '') => {
        const normalized = safeText(line);
        if (!normalized) return;
        if (normalized.length <= maxChars) {
            lines.push(normalized);
            return;
        }
        const words = normalized.split(' ').filter(Boolean);
        let buffer = '';
        words.forEach((word) => {
            if (word.length > maxChars) {
                if (buffer) {
                    lines.push(buffer);
                    buffer = '';
                }
                for (let idx = 0; idx < word.length; idx += maxChars) {
                    lines.push(word.slice(idx, idx + maxChars));
                    if (lines.length >= maxLines) return;
                }
                return;
            }
            const candidate = buffer ? `${buffer} ${word}` : word;
            if (candidate.length <= maxChars) {
                buffer = candidate;
                return;
            }
            lines.push(buffer);
            buffer = word;
        });
        if (buffer && lines.length < maxLines) {
            lines.push(buffer);
        }
    };
    for (const token of tokens) {
        if (!current) {
            current = token;
            continue;
        }
        const next = `${current}, ${token}`;
        if (next.length <= maxChars) {
            current = next;
            continue;
        }
        pushLine(current);
        current = token;
        if (lines.length >= maxLines) break;
    }
    if (current && lines.length < maxLines) {
        pushLine(current);
    }
    return lines.slice(0, maxLines);
};

const buildAddressLines = (address = {}) => {
    if (!address || typeof address !== 'object') return [];
    const primary = [
        address.line1 || address.addressLine1 || address.address || '',
        address.line2 || address.addressLine2 || '',
        [address.city, address.state].filter(Boolean).join(', '),
        address.zip || address.postalCode || address.pincode || '',
        address.country || ''
    ]
        .map((part) => safeText(part))
        .filter(Boolean);

    const lines = [];
    primary.forEach((part) => {
        splitTextLines(part).forEach((line) => {
            if (lines.length < LABEL_MAX_ADDRESS_LINES) {
                lines.push(line);
            }
        });
    });
    return lines.slice(0, LABEL_MAX_ADDRESS_LINES);
};

export const isWebBluetoothSupported = () => {
    return typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && Boolean(navigator.bluetooth);
};

export const isWebUsbSupported = () => {
    return typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && Boolean(navigator.usb);
};

export const getAvailablePrinterTransports = () => {
    const transports = [];
    if (isWebBluetoothSupported()) transports.push('bluetooth');
    if (isWebUsbSupported()) transports.push('usb');
    return transports;
};

export const isLikelyMobilePrinterRuntime = () => {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '').toLowerCase();
    return /android|iphone|ipad|ipod|mobile/.test(ua);
};

export const getPrinterSupportState = () => {
    if (typeof window === 'undefined') {
        return { supported: false, reason: 'Window context unavailable', transports: [] };
    }
    const transports = getAvailablePrinterTransports();
    if (!transports.length) {
        return {
            supported: false,
            reason: 'Neither Web Bluetooth nor WebUSB is available in this browser',
            transports
        };
    }
    return { supported: true, reason: '', transports };
};

export const resolvePreferredPrinterTransports = ({ storedTransport = '', supportState = getPrinterSupportState() } = {}) => {
    const available = Array.isArray(supportState?.transports) ? supportState.transports : [];
    // Mobile printing is intentionally Bluetooth-only. WebUSB support is too inconsistent on mobile browsers
    // to treat USB as a valid fallback path in live admin use.
    if (isLikelyMobilePrinterRuntime()) {
        return available.includes('bluetooth') ? ['bluetooth'] : [];
    }
    const ordered = [];
    if (storedTransport && available.includes(storedTransport)) {
        ordered.push(storedTransport);
    }
    if (available.includes('bluetooth') && !ordered.includes('bluetooth')) {
        ordered.push('bluetooth');
    }
    if (available.includes('usb') && !ordered.includes('usb')) {
        ordered.push('usb');
    }
    return ordered;
};

export const getPreferredPrinterTransport = () => {
    return isLikelyMobilePrinterRuntime() ? 'bluetooth' : 'auto';
};

export const validateFromLabelData = (companyProfile = {}, order = {}) => {
    const senderName = safeText(companyProfile?.displayName);
    const senderPhone = safeText(companyProfile?.contactNumber);
    const senderLines = buildAddressLines({ address: companyProfile?.address });
    const orderRef = safeText(order?.order_ref || order?.orderRef || order?.id);
    const missing = [];
    if (!senderName) missing.push('company name');
    if (!senderPhone) missing.push('company contact number');
    if (!senderLines.length) missing.push('company address');
    return {
        ok: missing.length === 0,
        missing,
        details: {
            orderRef,
            senderName,
            senderPhone,
            senderLines
        }
    };
};

export const validateToLabelData = (order = {}) => {
    const shippingAddress = order?.shipping_address || order?.shippingAddress || {};
    const shippingName = safeText(shippingAddress?.name || shippingAddress?.fullName || order?.customer_name || order?.customerName || '');
    const shippingMobile = safeText(shippingAddress?.mobile || shippingAddress?.phone || order?.customer_mobile || order?.customerMobile || '');
    const shippingLines = buildAddressLines(shippingAddress);
    const orderRef = safeText(order?.order_ref || order?.orderRef || order?.id);
    const missing = [];
    if (!orderRef) missing.push('order reference');
    if (!shippingName) missing.push('recipient name');
    if (!shippingMobile) missing.push('recipient mobile');
    if (!shippingLines.length) missing.push('shipping address');
    return {
        ok: missing.length === 0,
        missing,
        details: {
            orderRef,
            shippingName,
            shippingMobile,
            shippingLines
        }
    };
};

export const validateShippingLabelData = (order = {}, companyProfile = {}) => {
    const fromValidation = validateFromLabelData(companyProfile, order);
    const toValidation = validateToLabelData(order);
    const missing = [...fromValidation.missing, ...toValidation.missing];
    return {
        ok: missing.length === 0,
        missing,
        details: {
            ...fromValidation.details,
            ...toValidation.details
        }
    };
};

export const buildFromLabelPayload = (companyProfile = {}, order = {}) => {
    const validation = validateFromLabelData(companyProfile, order);
    if (!validation.ok) {
        throw new Error(`Missing from label data: ${validation.missing.join(', ')}`);
    }
    const { orderRef, senderName, senderPhone, senderLines } = validation.details;
    return {
        orderRef,
        sender: {
            name: senderName,
            phone: senderPhone,
            addressLines: senderLines
        }
    };
};

export const buildToLabelPayload = (order = {}) => {
    const validation = validateToLabelData(order);
    if (!validation.ok) {
        throw new Error(`Missing to label data: ${validation.missing.join(', ')}`);
    }
    const {
        orderRef,
        shippingName,
        shippingMobile,
        shippingLines
    } = validation.details;
    return {
        orderRef,
        recipient: {
            name: shippingName,
            phone: shippingMobile,
            addressLines: shippingLines
        }
    };
};

export const buildShippingLabelPayload = (order = {}, companyProfile = {}) => {
    const validation = validateShippingLabelData(order, companyProfile);
    if (!validation.ok) {
        throw new Error(`Missing label data: ${validation.missing.join(', ')}`);
    }
    const {
        orderRef,
        shippingName,
        shippingMobile,
        shippingLines,
        senderName,
        senderPhone,
        senderLines
    } = validation.details;

    return {
        orderRef,
        sender: {
            name: senderName,
            phone: senderPhone,
            addressLines: senderLines
        },
        recipient: {
            name: shippingName,
            phone: shippingMobile,
            addressLines: shippingLines
        }
    };
};

const escPosText = (text = '') => new TextEncoder().encode(`${safeText(text)}\n`);
const escPosBytes = (...parts) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const escPosLeftAlign = () => Uint8Array.from([0x1b, 0x61, 0x00]);
const escPosNormalSize = () => Uint8Array.from([0x1d, 0x21, 0x00]);
const escPosBoldOn = () => Uint8Array.from([0x1b, 0x45, 0x01]);
const escPosBoldOff = () => Uint8Array.from([0x1b, 0x45, 0x00]);

const appendSmallHeading = (body = [], heading = '') => {
    body.push(escPosLeftAlign());
    body.push(escPosNormalSize());
    body.push(escPosBoldOn());
    body.push(escPosText(heading));
    body.push(escPosBoldOff());
};

const appendRecipientBlock = (body = [], payload = {}) => {
    body.push(escPosLeftAlign());
    body.push(escPosNormalSize());
    body.push(escPosText(String(payload?.recipient?.name || '')));
    (payload?.recipient?.addressLines || []).forEach((line) => body.push(escPosText(line)));
    body.push(escPosText(`Phone: ${payload?.recipient?.phone || ''}`));
    body.push(escPosBoldOn());
    body.push(escPosText(`Order Ref: ${payload?.orderRef || ''}`));
    body.push(escPosBoldOff());
};

const appendSenderBlock = (body = [], payload = {}) => {
    body.push(escPosLeftAlign());
    body.push(escPosNormalSize());
    body.push(escPosText(String(payload?.sender?.name || '')));
    (payload?.sender?.addressLines || []).forEach((line) => body.push(escPosText(line)));
    body.push(escPosText(`Phone: ${payload?.sender?.phone || ''}`));
    if (payload?.orderRef) {
        body.push(escPosBoldOn());
        body.push(escPosText(`Order Ref: ${payload.orderRef}`));
        body.push(escPosBoldOff());
    }
};

export const buildEscPosFromLabel = (payload = {}) => {
    const body = [];
    body.push(Uint8Array.from([0x1b, 0x40]));
    appendSmallHeading(body, 'From');
    appendSenderBlock(body, payload);
    body.push(Uint8Array.from([0x1b, 0x64, 0x04]));
    body.push(Uint8Array.from([0x1d, 0x56, 0x42, 0x00]));
    return escPosBytes(...body);
};

export const buildEscPosToLabel = (payload = {}) => {
    const body = [];
    body.push(Uint8Array.from([0x1b, 0x40]));
    appendSmallHeading(body, 'Ship To');
    appendRecipientBlock(body, payload);
    body.push(Uint8Array.from([0x1b, 0x64, 0x04]));
    body.push(Uint8Array.from([0x1d, 0x56, 0x42, 0x00]));
    return escPosBytes(...body);
};

export const buildEscPosLabel = (payload = {}) => {
    const body = [];
    body.push(Uint8Array.from([0x1b, 0x40])); // init
    appendSmallHeading(body, 'Ship To');
    appendRecipientBlock(body, payload);
    body.push(escPosText(''));
    body.push(escPosText(''));
    appendSmallHeading(body, 'From');
    appendSenderBlock(body, payload);
    body.push(Uint8Array.from([0x1b, 0x64, 0x04])); // feed
    body.push(Uint8Array.from([0x1d, 0x56, 0x42, 0x00])); // partial cut if supported
    return escPosBytes(...body);
};

const readStoredPrinter = () => {
    try {
        const raw = localStorage.getItem(PRINTER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const writeStoredPrinter = (printer = null) => {
    try {
        if (!printer) {
            localStorage.removeItem(PRINTER_STORAGE_KEY);
            return;
        }
        localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(printer));
    } catch {
        // ignore storage failures
    }
};

export const getStoredPrinterPreference = () => {
    return readStoredPrinter();
};

export const clearStoredPrinterPreference = () => {
    writeStoredPrinter(null);
};

const characteristicSupportsWrite = (characteristic) => {
    const props = characteristic?.properties || {};
    return Boolean(props.write || props.writeWithoutResponse);
};

const usbEndpointSupportsWrite = (endpoint = {}) => {
    return String(endpoint?.direction || '').toLowerCase() === 'out';
};

const findWritableCharacteristic = async (server) => {
    for (const serviceUuid of PRINTER_SERVICE_UUIDS) {
        try {
            const service = await server.getPrimaryService(serviceUuid);
            const characteristics = await service.getCharacteristics();
            const writable = characteristics.find(characteristicSupportsWrite);
            if (writable) {
                return { serviceUuid, characteristic: writable };
            }
        } catch {
            // try next known service
        }
    }
    const allServices = await server.getPrimaryServices();
    for (const service of allServices) {
        const characteristics = await service.getCharacteristics().catch(() => []);
        const writable = characteristics.find(characteristicSupportsWrite);
        if (writable) {
            return { serviceUuid: service.uuid, characteristic: writable };
        }
    }
    throw new Error('No writable thermal printer characteristic found');
};

const requestPrinterDevice = async () => {
    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICE_UUIDS
    });
    return device;
};

const requestUsbPrinterDevice = async () => {
    if (!navigator.usb?.requestDevice) {
        throw new Error('WebUSB is unavailable in this browser');
    }
    const timeoutPromise = new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('USB device selection timed out')), USB_REQUEST_TIMEOUT_MS);
    });
    return Promise.race([
        navigator.usb.requestDevice({ filters: USB_PRINTER_FILTERS }),
        timeoutPromise
    ]);
};

const reconnectStoredDevice = async (stored = null) => {
    if (!navigator.bluetooth?.getDevices || !stored?.deviceId) return null;
    const devices = await navigator.bluetooth.getDevices();
    return devices.find((device) => String(device.id) === String(stored.deviceId)) || null;
};

const reconnectStoredUsbDevice = async (stored = null) => {
    if (!navigator.usb?.getDevices || !stored?.vendorId || !stored?.productId) return null;
    const devices = await navigator.usb.getDevices();
    return devices.find((device) =>
        Number(device.vendorId) === Number(stored.vendorId)
        && Number(device.productId) === Number(stored.productId)
    ) || null;
};

const findUsbWriteEndpoint = async (device) => {
    await device.open();
    if (!device.configuration) {
        await device.selectConfiguration(1);
    }
    const interfaces = device.configuration?.interfaces || [];
    for (const iface of interfaces) {
        for (const alternate of (iface.alternates || [])) {
            const endpoint = (alternate.endpoints || []).find(usbEndpointSupportsWrite);
            if (!endpoint) continue;
            try {
                await device.claimInterface(iface.interfaceNumber);
                if (alternate.alternateSetting !== iface.alternate?.alternateSetting) {
                    await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting);
                }
                return {
                    interfaceNumber: iface.interfaceNumber,
                    endpointNumber: endpoint.endpointNumber
                };
            } catch {
                // keep searching
            }
        }
    }
    throw new Error('No writable USB printer endpoint found');
};

const connectBluetoothThermalPrinter = async ({ forceReconnect = false, stored = null } = {}) => {
    let device = null;
    if (!forceReconnect) {
        device = await reconnectStoredDevice(stored);
    }
    if (!device) {
        device = await requestPrinterDevice();
    }
    if (!device) {
        throw new Error('No Bluetooth printer selected');
    }

    const server = device.gatt?.connected ? device.gatt : await device.gatt?.connect();
    if (!server) {
        throw new Error('Unable to connect to Bluetooth printer');
    }

    const { serviceUuid, characteristic } = await findWritableCharacteristic(server);
    const printer = {
        id: device.id,
        name: device.name || 'Thermal printer',
        serviceUuid,
        characteristicUuid: characteristic.uuid,
        transport: 'bluetooth'
    };
    writeStoredPrinter({
        transport: 'bluetooth',
        deviceId: device.id,
        deviceName: printer.name,
        serviceUuid,
        characteristicUuid: characteristic.uuid
    });

    return { transport: 'bluetooth', printer, writer: characteristic };
};

const connectUsbThermalPrinter = async ({ forceReconnect = false, stored = null } = {}) => {
    let device = null;
    if (!forceReconnect) {
        device = await reconnectStoredUsbDevice(stored);
    }
    if (!device) {
        device = await requestUsbPrinterDevice();
    }
    if (!device) {
        throw new Error('No USB printer selected');
    }
    const { interfaceNumber, endpointNumber } = await findUsbWriteEndpoint(device);
    const printer = {
        id: `${device.vendorId}:${device.productId}`,
        name: device.productName || 'USB thermal printer',
        vendorId: device.vendorId,
        productId: device.productId,
        interfaceNumber,
        endpointNumber,
        transport: 'usb'
    };
    writeStoredPrinter({
        transport: 'usb',
        vendorId: device.vendorId,
        productId: device.productId,
        productName: printer.name,
        interfaceNumber,
        endpointNumber
    });
    return {
        transport: 'usb',
        printer,
        writer: { device, endpointNumber }
    };
};

export const connectThermalPrinter = async ({ forceReconnect = false, transport = 'auto' } = {}) => {
    const support = getPrinterSupportState();
    if (!support.supported) {
        throw new Error(support.reason);
    }

    const stored = readStoredPrinter();
    const preferredTransports = transport === 'auto'
        ? resolvePreferredPrinterTransports({ storedTransport: forceReconnect ? '' : stored?.transport, supportState: support })
        : [transport];

    let lastError = null;
    for (const candidate of preferredTransports) {
        try {
            if (candidate === 'bluetooth') {
                return await connectBluetoothThermalPrinter({ forceReconnect, stored });
            }
            if (candidate === 'usb') {
                return await connectUsbThermalPrinter({ forceReconnect, stored });
            }
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('No supported printer transport available');
};

export const configurePreferredPrinter = async ({ transport = 'auto' } = {}) => {
    // Force a fresh device selection from Settings so the saved preference always reflects the admin's
    // latest chosen printer instead of silently reusing a stale pairing.
    const connection = await connectThermalPrinter({ forceReconnect: true, transport });
    return connection.printer;
};

const writeBluetoothInChunks = async (characteristic, bytes) => {
    for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
        const chunk = bytes.slice(offset, offset + WRITE_CHUNK_BYTES);
        if (characteristic.properties?.writeWithoutResponse && !characteristic.properties?.write) {
            await characteristic.writeValueWithoutResponse(chunk);
        } else {
            await characteristic.writeValue(chunk);
        }
    }
};

const writeUsbInChunks = async (device, endpointNumber, bytes) => {
    for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
        const chunk = bytes.slice(offset, offset + WRITE_CHUNK_BYTES);
        await device.transferOut(endpointNumber, chunk);
    }
};

const printPreparedLabel = async ({ payload, labelBytes, forceReconnect = false, onProgress = null, transport = 'auto' } = {}) => {
    if (typeof onProgress === 'function') onProgress('connecting');
    const connection = await connectThermalPrinter({ forceReconnect, transport });
    if (typeof onProgress === 'function') onProgress('printing');
    if (connection.transport === 'bluetooth') {
        await writeBluetoothInChunks(connection.writer, labelBytes);
    } else if (connection.transport === 'usb') {
        await writeUsbInChunks(connection.writer.device, connection.writer.endpointNumber, labelBytes);
    } else {
        throw new Error('Unsupported printer transport');
    }
    return { printer: connection.printer, payload };
};

export const printFromLabel = async ({ order, companyProfile, forceReconnect = false, onProgress = null, transport = 'auto' } = {}) => {
    const payload = buildFromLabelPayload(companyProfile, order);
    const labelBytes = buildEscPosFromLabel(payload);
    return printPreparedLabel({ payload, labelBytes, forceReconnect, onProgress, transport });
};

export const printToLabel = async ({ order, forceReconnect = false, onProgress = null, transport = 'auto' } = {}) => {
    const payload = buildToLabelPayload(order);
    const labelBytes = buildEscPosToLabel(payload);
    return printPreparedLabel({ payload, labelBytes, forceReconnect, onProgress, transport });
};

export const printShippingLabel = async ({ order, companyProfile, forceReconnect = false, onProgress = null, transport = 'auto' } = {}) => {
    const payload = buildShippingLabelPayload(order, companyProfile);
    const labelBytes = buildEscPosLabel(payload);
    return printPreparedLabel({ payload, labelBytes, forceReconnect, onProgress, transport });
};
