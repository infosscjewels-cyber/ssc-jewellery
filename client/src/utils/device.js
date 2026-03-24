export const isAppleMobileDevice = () => {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';

  const isIphoneOrIpod = /iPhone|iPod/i.test(ua);
  const isIpad = /iPad/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return isIphoneOrIpod || isIpad;
};
