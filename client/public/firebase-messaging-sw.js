/* global importScripts, firebase */
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAV4JSY_ArHlddGqS-4H7UMzTeYF1wRM4s',
  authDomain: 'ssc-impon-jewellery.firebaseapp.com',
  projectId: 'ssc-impon-jewellery',
  storageBucket: 'ssc-impon-jewellery.firebasestorage.app',
  messagingSenderId: '831006915410',
  appId: '1:831006915410:web:15850b4acad6ca6cd9188b',
  measurementId: 'G-YD44X0T3V5'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload?.notification || {};
  const webpush = payload?.webpush?.notification || {};
  const title = notification.title || webpush.title || 'SSC Jewels';
  const options = {
    body: notification.body || webpush.body || '',
    icon: webpush.icon || '/logo.webp',
    badge: webpush.badge || '/logo.webp',
    tag: webpush.tag || payload?.data?.tag || undefined,
    data: {
      link: payload?.fcmOptions?.link || payload?.data?.link || payload?.data?.url || '/admin'
    }
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event?.notification?.data?.link || '/admin';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target);
      }
      return undefined;
    })
  );
});
