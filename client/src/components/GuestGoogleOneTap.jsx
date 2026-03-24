import { useEffect, useRef, useState } from 'react';
import { useGoogleOneTapLogin } from '@react-oauth/google';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import { isAppleMobileDevice } from '../utils/device';

const AUTO_REAUTH_COOLDOWN_MS = 10 * 60 * 1000;
const ONE_TAP_LAST_ATTEMPT_KEY = 'oneTapLastAttemptAt';

const getLastOneTapAttemptAt = () => {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(ONE_TAP_LAST_ATTEMPT_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const markOneTapAttempt = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ONE_TAP_LAST_ATTEMPT_KEY, String(Date.now()));
};

function GuestGoogleOneTapEnabled() {
  const { user, login } = useAuth();
  const location = useLocation();
  const isAuthenticatingRef = useRef(false);
  const [cooldownActive, setCooldownActive] = useState(() => {
    const elapsed = Date.now() - getLastOneTapAttemptAt();
    return elapsed < AUTO_REAUTH_COOLDOWN_MS;
  });

  const isGuest = !user;
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isForgotPasswordRoute = location.pathname.startsWith('/forgot-password');
  const isApplePhone = isAppleMobileDevice();
  const isEnabled = isGuest && !isAdminRoute && !isForgotPasswordRoute && !isApplePhone && !cooldownActive;

  useEffect(() => {
    if (!cooldownActive) return;
    const elapsed = Date.now() - getLastOneTapAttemptAt();
    const remaining = AUTO_REAUTH_COOLDOWN_MS - elapsed;
    if (remaining <= 0) {
      setCooldownActive(false);
      return;
    }
    const timer = window.setTimeout(() => setCooldownActive(false), remaining);
    return () => window.clearTimeout(timer);
  }, [cooldownActive]);

  useGoogleOneTapLogin({
    auto_select: true,
    cancel_on_tap_outside: false,
    disabled: !isEnabled,
    onSuccess: async ({ credential }) => {
      if (!credential || isAuthenticatingRef.current) return;
      isAuthenticatingRef.current = true;
      markOneTapAttempt();
      setCooldownActive(true);

      try {
        const firebaseCredential = GoogleAuthProvider.credential(credential);
        const firebaseUser = await signInWithCredential(auth, firebaseCredential);
        const firebaseToken = await firebaseUser.user.getIdToken();
        const res = await authService.socialLogin(firebaseToken);
        if (res?.token) {
          login(res.token, res.user);
        }
      } catch (error) {
        console.error('Google One Tap login failed:', error);
      } finally {
        isAuthenticatingRef.current = false;
      }
    },
    onError: () => {
      markOneTapAttempt();
      setCooldownActive(true);
      console.warn('Google One Tap did not initialize or was blocked by browser/Google policy.', {
        isGuest,
        isAdminRoute,
        isForgotPasswordRoute,
        isApplePhone,
        host: typeof window !== 'undefined' ? window.location.host : ''
      });
    }
  });

  return null;
}

export default function GuestGoogleOneTap() {
  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  if (!hasGoogleClientId) return null;

  return <GuestGoogleOneTapEnabled />;
}
