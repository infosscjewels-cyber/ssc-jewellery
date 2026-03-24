export const burstConfetti = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '320';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        canvas.remove();
        return;
    }

    const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#ec4899'];
    const particles = Array.from({ length: 140 }).map(() => ({
        x: canvas.width / 2,
        y: canvas.height / 3,
        vx: (Math.random() - 0.5) * 11,
        vy: Math.random() * -10 - 3,
        size: Math.random() * 4 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 90 + Math.random() * 25
    }));

    let frame = 0;
    const tick = () => {
        frame += 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.17;
            p.life -= 1;
            if (p.life <= 0) return;
            ctx.globalAlpha = Math.max(0, p.life / 115);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
        });
        ctx.globalAlpha = 1;
        if (frame < 120) {
            requestAnimationFrame(tick);
        } else {
            canvas.remove();
        }
    };
    requestAnimationFrame(tick);
};

export const playCue = (src, { volume = 0.9 } = {}) => {
    try {
        if (!src) return;
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.playsInline = true;
        audio.crossOrigin = 'anonymous';
        audio.volume = volume;
        // Keep a live reference to avoid the element being GC'd mid-playback.
        if (typeof window !== 'undefined') window.__sscPopupAudioRef = audio;
        const markPlayed = () => {
            if (typeof window !== 'undefined') window.__sscPopupAudioPlayedAt = Date.now();
        };
        audio.addEventListener('playing', markPlayed, { once: true });
        void audio.play().catch(async () => {
            // Fallback: attempt muted autoplay, then unmute.
            try {
                audio.muted = true;
                await audio.play();
                setTimeout(() => {
                    audio.muted = false;
                    audio.volume = volume;
                }, 80);
                markPlayed();
            } catch {
                // Final fallback: retry once on first user interaction.
                if (typeof window !== 'undefined') {
                    const retry = () => {
                        window.removeEventListener('pointerdown', retry, true);
                        window.removeEventListener('keydown', retry, true);
                        window.removeEventListener('touchstart', retry, true);
                        audio.muted = false;
                        audio.volume = volume;
                        void audio.play().catch(() => {});
                    };
                    window.removeEventListener('pointerdown', retry, true);
                    window.removeEventListener('keydown', retry, true);
                    window.removeEventListener('touchstart', retry, true);
                    window.addEventListener('pointerdown', retry, true);
                    window.addEventListener('keydown', retry, true);
                    window.addEventListener('touchstart', retry, true);
                }
            }
        });
    } catch {
        // ignore
    }
};
