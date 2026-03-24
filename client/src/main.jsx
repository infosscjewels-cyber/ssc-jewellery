import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import { installFetchRetry } from './utils/fetchRetry'
import './index.css'

installFetchRetry()

if (import.meta.env.PROD) {
  registerSW({ immediate: true })
} else if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister().catch(() => {})
    })
  }).catch(() => {})
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
const appNode = googleClientId ? (
  <GoogleOAuthProvider clientId={googleClientId}>
    <App />
  </GoogleOAuthProvider>
) : (
  <App />
)

ReactDOM.createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? appNode : <React.StrictMode>{appNode}</React.StrictMode>,
)
