import { SupportedLanguage } from '../types';

export function speakText(text: string, language: SupportedLanguage = 'Telugu', onEnd?: () => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  try {
    window.speechSynthesis.cancel();

    // Clean markdown, bracket tags, or internal markers before speaking
    const cleanText = text
      .replace(/[*_#`[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return false;

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Target Telugu locale
    utterance.lang = 'te-IN';
    utterance.rate = 0.95; // Slightly measured rate for clear speech
    utterance.pitch = 1.0;

    // Pick best matching Telugu voice if available
    const voices = window.speechSynthesis.getVoices();
    const teluguVoice = voices.find(
      (v) =>
        v.lang === 'te-IN' ||
        v.lang.startsWith('te') ||
        v.name.toLowerCase().includes('telugu')
    );
    if (teluguVoice) {
      utterance.voice = teluguVoice;
    }

    if (onEnd) {
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
    }

    window.speechSynthesis.speak(utterance);
    return true;
  } catch (e) {
    console.warn('Speech synthesis playback error:', e);
    return false;
  }
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
