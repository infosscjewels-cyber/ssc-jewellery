import facebookLikesSound from '../assets/facebook_likes.mp3';

let clickAudio = null;

export const playFacebookLikeSound = () => {
    if (typeof window === 'undefined') return;
    try {
        if (!clickAudio) {
            clickAudio = new Audio(facebookLikesSound);
            clickAudio.preload = 'auto';
        }
        clickAudio.pause();
        clickAudio.currentTime = 0;
        void clickAudio.play();
    } catch {
        // Ignore autoplay or playback errors.
    }
};

