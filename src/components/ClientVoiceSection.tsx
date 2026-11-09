import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Square,
  Play,
  Pause,
  RotateCcw,
  Upload,
  Check,
  Sparkles,
  Volume2,
  VolumeX,
  Radio,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileAudio,
  CheckCircle2,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { ClientVoiceProfile } from '../types';

interface ClientVoiceSectionProps {
  clientId?: string;
  activeProfile: ClientVoiceProfile | null;
  onVoiceActivated: (profile: ClientVoiceProfile) => void;
  useClonedVoiceForSurvey: boolean;
  onToggleUseClonedVoice: (enabled: boolean) => void;
  isAgentSpeaking: boolean;
  onStartSurveyTest?: () => void;
}

export const ClientVoiceSection: React.FC<ClientVoiceSectionProps> = ({
  clientId = 'client_001',
  activeProfile,
  onVoiceActivated,
  useClonedVoiceForSurvey,
  onToggleUseClonedVoice,
  isAgentSpeaking,
  onStartSurveyTest,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Recording State
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);

  // Audio recorded/uploaded
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>('client_voice_sample.webm');

  // Playback state for user's recorded audio
  const [isPlayingRecording, setIsPlayingRecording] = useState<boolean>(false);
  const recordedAudioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Playback state for saved/existing voice preview
  const [isPlayingExistingVoice, setIsPlayingExistingVoice] = useState<boolean>(false);
  const existingAudioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Flow mode: 'normal' (first time or viewing) | 'recording_new' (client chose "Record New Voice")
  const [flowMode, setFlowMode] = useState<'normal' | 'recording_new'>('normal');

  // Candidate new voice for "Record New Voice" comparison
  const [candidateVoice, setCandidateVoice] = useState<{
    voice_id: string;
    preview_url: string;
    preview_text?: string;
    created_at: string;
  } | null>(null);
  const [isPlayingCandidatePreview, setIsPlayingCandidatePreview] = useState<boolean>(false);
  const candidateAudioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // File input ref for upload audio
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Format seconds to mm:ss (e.g. 00:01, 00:02...)
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Check backend active voice on mount or when clientId changes
  const checkActiveVoice = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const res = await fetch(`/api/voice-profile/active/${encodeURIComponent(clientId)}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();

      if (data.has_active_voice && data.profile) {
        onVoiceActivated(data.profile);
        setStatusMessage('మీ voice ఇప్పటికే save అయి ఉంది.');
      } else {
        setStatusMessage('వాయిస్ ఇంకా save కాలేదు.');
      }
    } catch (err: any) {
      console.warn('Failed to fetch active voice profile:', err?.message);
      setStatusMessage('వాయిస్ ఇంకా save కాలేదు.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkActiveVoice();
  }, [clientId]);

  // Clean up timers and audio on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (recordedAudioPlayerRef.current) {
        recordedAudioPlayerRef.current.pause();
        recordedAudioPlayerRef.current = null;
      }
      if (existingAudioPlayerRef.current) {
        existingAudioPlayerRef.current.pause();
        existingAudioPlayerRef.current = null;
      }
      if (candidateAudioPlayerRef.current) {
        candidateAudioPlayerRef.current.pause();
        candidateAudioPlayerRef.current = null;
      }
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  // START RECORDING
  const handleStartRecording = async () => {
    setErrorMessage(null);
    setRecordedBlob(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('మీ బ్రౌజర్ మైక్రోఫోన్ రికార్డింగ్‌కు సపోర్ట్ చేయడం లేదు. దయచేసి ఆడియో ఫైల్‌ను అప్‌లోడ్ చేయండి.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setRecordedBlob(finalBlob);
        const url = URL.createObjectURL(finalBlob);
        setRecordedUrl(url);
        setAudioFileName(`voice_sample_${Date.now()}.webm`);

        // Stop all tracks to release mic
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start(250); // Slice chunks every 250ms
      setIsRecording(true);
      setRecordingSeconds(0);

      // Start recording timer: 00:01, 00:02...
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('Microphone recording error / permission not granted:', err?.name || err?.message || err);
      const isPermissionDenied =
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError' ||
        /permission/i.test(err?.message || '') ||
        /denied/i.test(err?.message || '');

      if (isPermissionDenied) {
        setErrorMessage(
          'మైక్రోఫోన్ యాక్సెస్ అనుమతి లభించలేదు (Microphone permission denied). మీ బ్రౌజర్ సెట్టింగ్స్‌లో మైక్ పర్మిషన్ Allow చేయండి లేదా కింద ఉన్న "నమూనా ఆడియో వాడండి" లేదా "ఆడియో ఫైల్ అప్‌లోడ్" ఎంపికలను ఉపయోగించండి.'
        );
      } else {
        setErrorMessage(
          err?.message || 'మైక్రోఫోన్ యాక్సెస్ అనుమతి లభించలేదు. దయచేసి మైక్ పర్మిషన్ చెక్ చేయండి లేదా ఆడియో ఫైల్ అప్‌లోడ్ చేయండి.'
        );
      }
      setIsRecording(false);
    }
  };

  // STOP RECORDING
  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // PLAY RECORDING (User listens to their own recorded sample)
  const handleTogglePlayRecording = () => {
    if (!recordedUrl) return;

    if (!recordedAudioPlayerRef.current) {
      const audio = new Audio(recordedUrl);
      audio.onended = () => setIsPlayingRecording(false);
      audio.onerror = () => setIsPlayingRecording(false);
      recordedAudioPlayerRef.current = audio;
    }

    if (isPlayingRecording) {
      recordedAudioPlayerRef.current.pause();
      setIsPlayingRecording(false);
    } else {
      recordedAudioPlayerRef.current.play().catch((e) => {
        console.warn('Playback error:', e);
        setIsPlayingRecording(false);
      });
      setIsPlayingRecording(true);
    }
  };

  // RECORD AGAIN (Re-record)
  const handleRecordAgain = () => {
    if (isPlayingRecording && recordedAudioPlayerRef.current) {
      recordedAudioPlayerRef.current.pause();
      setIsPlayingRecording(false);
    }
    setRecordedBlob(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    setRecordingSeconds(0);
    setCandidateVoice(null);
    handleStartRecording();
  };

  // HANDLE FILE UPLOAD
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setRecordedBlob(file);
    setAudioFileName(file.name);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    const url = URL.createObjectURL(file);
    setRecordedUrl(url);
    setRecordingSeconds(15); // Nominal indicator for uploaded clip
  };

  // LOAD READY-MADE TELUGU DEMO SAMPLE AUDIO (Immediate testing when microphone is unavailable or blocked)
  const handleUseSampleAudio = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/voice-profile/sample-audio');
      if (!res.ok) throw new Error('Sample audio could not be retrieved');
      const blob = await res.blob();
      setRecordedBlob(blob);
      setAudioFileName('telugu_sample_voice.wav');
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
      const url = URL.createObjectURL(blob);
      setRecordedUrl(url);
      setRecordingSeconds(12);
      setStatusMessage('నమూనా తెలుగు ఆడియో లోడ్ చేయబడింది. మీరు ఇప్పుడు ప్లే చేయవచ్చు లేదా Create Voice క్లిక్ చేయవచ్చు.');
    } catch (err: any) {
      console.warn('Error loading demo audio sample:', err);
      setErrorMessage('నమూనా ఆడియో లోడ్ చేయడంలో సమస్య ఏర్పడింది. దయచేసి ఆడియో ఫైల్‌ను అప్‌లోడ్ చేయండి.');
    } finally {
      setIsLoading(false);
    }
  };

  // SEND RECORDING TO ELEVENLABS (Create Voice)
  const handleCreateVoice = async () => {
    if (!recordedBlob) {
      setErrorMessage('దయచేసి ముందుగా మీ వాయిస్‌ను రికార్డ్ చేయండి లేదా ఆడియో ఫైల్‌ను అప్‌లోడ్ చేయండి.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('client_id', clientId);
      formData.append('audio', recordedBlob, audioFileName);
      formData.append('voice_name', `Client_${clientId}_Voice`);
      formData.append(
        'mode',
        flowMode === 'recording_new' && activeProfile ? 'new_recording' : 'first_time'
      );

      const res = await fetch('/api/voice-profile/create', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.error || `సర్వర్‌తో కనెక్ట్ కాలేదు (${res.status})`);
      }

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'వాయిస్ క్లోనింగ్ విఫలమైంది');
      }

      // Check if this is a "Record New Voice" candidate flow
      if (data.is_new_candidate && flowMode === 'recording_new') {
        setCandidateVoice({
          voice_id: data.voice_id,
          preview_url: data.preview_url,
          preview_text: data.preview_text,
          created_at: data.created_at,
        });
        setStatusMessage('కొత్త వాయిస్ ప్రివ్యూ సిద్ధంగా ఉంది (New voice preview ready).');
      } else {
        // First-time or instant active voice
        const newProfile: ClientVoiceProfile = {
          client_id: data.client_id,
          voice_id: data.voice_id,
          provider: 'elevenlabs',
          status: 'active',
          voice_status: 'Active',
          created_at: data.created_at,
          updated_at: data.updated_at,
          preview_audio_url: data.preview_url,
        };
        onVoiceActivated(newProfile);
        setStatusMessage('మీ voice ఇప్పటికే save అయి ఉంది.');
        setCandidateVoice(null);
        setFlowMode('normal');
      }

      // Reset local recording state
      setRecordedBlob(null);
    } catch (err: any) {
      console.warn('Create voice error:', err?.message || err);
      setErrorMessage(err?.message || 'వాయిస్ క్లోన్ చేయడంలో సమస్య ఏర్పడింది. దయచేసి మళ్లీ ప్రయత్నించండి.');
    } finally {
      setIsLoading(false);
    }
  };

  // PLAY EXISTING ACTIVE VOICE
  const handleTogglePlayExistingVoice = () => {
    if (!activeProfile?.voice_id) return;

    if (!existingAudioPlayerRef.current) {
      const audioUrl = `/api/voice-profile/preview-audio/${encodeURIComponent(
        activeProfile.voice_id
      )}?t=${Date.now()}`;
      const audio = new Audio(audioUrl);
      audio.onended = () => setIsPlayingExistingVoice(false);
      audio.onerror = () => setIsPlayingExistingVoice(false);
      existingAudioPlayerRef.current = audio;
    }

    if (isPlayingExistingVoice) {
      existingAudioPlayerRef.current.pause();
      setIsPlayingExistingVoice(false);
    } else {
      existingAudioPlayerRef.current.play().catch((e) => {
        console.warn('Playback error:', e);
        setIsPlayingExistingVoice(false);
      });
      setIsPlayingExistingVoice(true);
    }
  };

  // PLAY CANDIDATE NEW VOICE PREVIEW
  const handleTogglePlayCandidatePreview = () => {
    if (!candidateVoice?.voice_id) return;

    if (!candidateAudioPlayerRef.current) {
      const audioUrl = `/api/voice-profile/preview-audio/${encodeURIComponent(
        candidateVoice.voice_id
      )}?t=${Date.now()}`;
      const audio = new Audio(audioUrl);
      audio.onended = () => setIsPlayingCandidatePreview(false);
      audio.onerror = () => setIsPlayingCandidatePreview(false);
      candidateAudioPlayerRef.current = audio;
    }

    if (isPlayingCandidatePreview) {
      candidateAudioPlayerRef.current.pause();
      setIsPlayingCandidatePreview(false);
    } else {
      candidateAudioPlayerRef.current.play().catch((e) => {
        console.warn('Playback error:', e);
        setIsPlayingCandidatePreview(false);
      });
      setIsPlayingCandidatePreview(true);
    }
  };

  // USE NEW VOICE (old voice = archived, new voice = active)
  const handleUseNewVoice = async () => {
    if (!candidateVoice) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/voice-profile/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          voice_id: candidateVoice.voice_id,
        }),
      });

      if (!res.ok) throw new Error('వాయిస్ యాక్టివేషన్ విఫలమైంది');
      const data = await res.json();

      const newProfile: ClientVoiceProfile = {
        client_id: clientId,
        voice_id: candidateVoice.voice_id,
        provider: 'elevenlabs',
        status: 'active',
        created_at: candidateVoice.created_at,
        updated_at: new Date().toISOString(),
      };

      onVoiceActivated(newProfile);
      setCandidateVoice(null);
      setFlowMode('normal');
      setStatusMessage('మీ voice ఇప్పటికే save అయి ఉంది.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'కొత్త వాయిస్ యాక్టివేట్ చేయడంలో లోపం ఏర్పడింది.');
    } finally {
      setIsLoading(false);
    }
  };

  // KEEP PREVIOUS VOICE (old voice remains active)
  const handleKeepPreviousVoice = async () => {
    if (!candidateVoice) return;
    setIsLoading(true);
    try {
      await fetch('/api/voice-profile/keep-previous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          candidate_voice_id: candidateVoice.voice_id,
        }),
      });

      setCandidateVoice(null);
      setFlowMode('normal');
      setStatusMessage('మునుపటి వాయిస్ కొనసాగించబడుతోంది.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'మునుపటి వాయిస్ సేవ్ చేయడంలో లోపం ఏర్పడింది.');
    } finally {
      setIsLoading(false);
    }
  };

  // RECORD NEW VOICE (Starts new recording flow while keeping existing active voice safe)
  const handleStartRecordNewVoiceFlow = () => {
    setFlowMode('recording_new');
    setRecordedBlob(null);
    setCandidateVoice(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    handleStartRecording();
  };

  // USE THIS VOICE FOR SURVEY
  const handleUseThisVoiceForSurvey = () => {
    onToggleUseClonedVoice(true);
    if (onStartSurveyTest) {
      onStartSurveyTest();
    }
  };

  const hasSavedVoice = Boolean(activeProfile && activeProfile.voice_id);

  return (
    <div className="bg-white border-b border-zinc-200 shadow-xs transition-all">
      {/* Top Header Row of the Section */}
      <div className="px-4 py-3 sm:px-6 flex items-center justify-between bg-zinc-50/80 border-b border-zinc-200">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold tracking-tight text-zinc-900 flex items-center gap-1.5">
                <span>క్లయింట్ వాయిస్</span>
                <span className="text-zinc-400 font-normal text-xs">/ Client Voice</span>
              </h2>

              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300">
                ElevenLabs Voice Clone
              </span>

              {/* Status Badge */}
              {hasSavedVoice ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                  Voice Status: Active
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                  <AlertCircle className="w-3 h-3 mr-1 text-amber-600" />
                  వాయిస్ ఇంకా save కాలేదు
                </span>
              )}

              {/* Active Cloned Voice In Survey Badge */}
              {hasSavedVoice && useClonedVoiceForSurvey && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <Radio className="w-2.5 h-2.5 mr-1 text-indigo-600 animate-pulse" />
                  సర్వేలో యాక్టివ్
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              క్లయింట్ గొంతును రికార్డ్ చేసి ElevenLabs ద్వారా క్లోన్ చేయండి • సర్వేలో ప్రత్యక్షంగా పరీక్షించండి
            </p>
          </div>
        </div>

        {/* Right Header Controls: Expand/Collapse & Cloned Voice Toggle */}
        <div className="flex items-center gap-2">
          {hasSavedVoice && (
            <button
              onClick={() => onToggleUseClonedVoice(!useClonedVoiceForSurvey)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                useClonedVoiceForSurvey
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                  : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
              }`}
              title="సర్వేలో క్లోన్ చేసిన వాయిస్‌ను ఆన్/ఆఫ్ చేయండి"
            >
              {useClonedVoiceForSurvey ? (
                <>
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>క్లోన్ వాయిస్: ఆన్</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>క్లోన్ వాయిస్: ఆఫ్</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            className="p-1.5 rounded-md hover:bg-zinc-200 text-zinc-600 transition-colors"
            title={isExpanded ? 'కుదించు (Collapse)' : 'విస్తరించు (Expand)'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Agent Speaking Banner Indicator */}
      {isAgentSpeaking && (
        <div className="bg-emerald-900 text-white px-4 py-2 text-xs flex items-center justify-between border-b border-emerald-800 animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-300"></span>
            </span>
            <span className="font-semibold">
              {useClonedVoiceForSurvey && activeProfile
                ? `🎙️ క్లయింట్ క్లోన్ చేసిన వాయిస్‌తో ఏజెంట్ మాట్లాడుతోంది (${activeProfile.voice_id})`
                : '🗣️ AI ఏజెంట్ సమాధానం చెబుతోంది (Speaking)...'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] opacity-90">
            <span className="inline-block w-1.5 h-3 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></span>
            <span className="inline-block w-1.5 h-4 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></span>
            <span className="inline-block w-1.5 h-2.5 bg-white rounded-full animate-bounce"></span>
          </div>
        </div>
      )}

      {/* Main Section Content Area */}
      {isExpanded && (
        <div className="p-4 sm:p-6 space-y-4 bg-white">
          {/* Error alert banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium">{errorMessage}</div>
              </div>
              <div className="flex items-center gap-2 pt-1 pl-6 flex-wrap">
                <button
                  type="button"
                  onClick={handleUseSampleAudio}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 text-white font-semibold hover:bg-emerald-800 transition-colors shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
                  <span>నమూనా ఆడియోతో కొనసాగించండి (Use Sample Voice)</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-zinc-700 border border-zinc-300 font-medium hover:bg-zinc-100 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-zinc-600" />
                  <span>ఆడియో ఫైల్ అప్‌లోడ్ (Upload Audio)</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* FLOW A: CANDIDATE NEW VOICE PREVIEW (After "Record New Voice")           */}
          {/* ========================================================================= */}
          {candidateVoice && (
            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-300 space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-700" />
                  <span className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                    New voice preview
                  </span>
                </div>
                <span className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border border-amber-200 text-amber-900">
                  ID: {candidateVoice.voice_id}
                </span>
              </div>

              <p className="text-xs text-amber-900">
                కొత్త రికార్డింగ్‌తో ElevenLabs వాయిస్ క్లోన్ చేయబడింది. దయచేసి ప్రివ్యూ వినండి మరియు ఎంపిక చేసుకోండి:
              </p>

              {/* Preview Audio Controls */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <button
                  onClick={handleTogglePlayCandidatePreview}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-700 text-white hover:bg-amber-800 transition-colors shadow-xs"
                >
                  {isPlayingCandidatePreview ? (
                    <>
                      <Pause className="w-4 h-4" />
                      <span>ప్రివ్యూ ఆపు (Pause Preview)</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>▶ కొత్త వాయిస్ ప్రివ్యూ వినండి (Play New Voice)</span>
                    </>
                  )}
                </button>

                {/* Primary Decision Action Buttons */}
                <button
                  onClick={handleUseNewVoice}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors shadow-xs disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>Use New Voice</span>
                </button>

                <button
                  onClick={handleKeepPreviousVoice}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-100 transition-colors disabled:opacity-50"
                >
                  <span>Keep Previous Voice</span>
                </button>
              </div>
              <p className="text-[11px] text-amber-800 italic">
                * "Use New Voice" ఎంచుకుంటే మునుపటి వాయిస్ ఆర్కైవ్ చేయబడుతుంది. "Keep Previous Voice" ఎంచుకుంటే పాత వాయిస్ అలాగే కొనసాగుతుంది.
              </p>
            </div>
          )}

          {/* ========================================================================= */}
          {/* FLOW B: RETURNING CLIENT WITH ACTIVE SAVED VOICE                          */}
          {/* ========================================================================= */}
          {hasSavedVoice && !candidateVoice && flowMode === 'normal' && (
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-ping"></div>
                  <h3 className="text-sm font-bold text-emerald-950">
                    మీ voice ఇప్పటికే save అయి ఉంది.
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-300">
                    Voice Status: Active
                  </span>
                  <span className="text-[11px] font-mono text-zinc-600 bg-white px-2 py-0.5 rounded border border-zinc-200">
                    {activeProfile?.voice_id}
                  </span>
                </div>
              </div>

              {/* Voice Preview Box with Fixed Telugu Test Sentence */}
              <div className="p-3 bg-white rounded-lg border border-emerald-300 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-emerald-900 tracking-wide uppercase flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                    Voice Preview (వాయిస్ ప్రివ్యూ)
                  </span>
                  <span className="text-[10px] text-zinc-400">Fixed Test Sentence</span>
                </div>
                <p className="text-xs text-zinc-800 font-medium italic border-l-2 border-emerald-500 pl-2.5 py-0.5">
                  "నమస్కారం అండి. మీ ప్రాంతంలోని ప్రజా సదుపాయాల గురించి కొన్ని ప్రశ్నలు అడగడానికి కాల్ చేస్తున్నాము."
                </p>
                <div className="pt-0.5">
                  <button
                    onClick={handleTogglePlayExistingVoice}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors shadow-xs"
                  >
                    {isPlayingExistingVoice ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        <span>ఆపు (Pause)</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>▶ Play</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Action Buttons as specified in User Section 6 */}
              <div className="flex items-center gap-2.5 flex-wrap pt-1">
                {/* [▶ Play Existing Voice] */}
                <button
                  onClick={handleTogglePlayExistingVoice}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-800 text-white hover:bg-emerald-900 transition-colors shadow-xs"
                >
                  {isPlayingExistingVoice ? (
                    <>
                      <Pause className="w-4 h-4" />
                      <span>ఆపు (Pause Voice)</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>▶ Play Existing Voice</span>
                    </>
                  )}
                </button>

                {/* [Use This Voice] */}
                <button
                  onClick={handleUseThisVoiceForSurvey}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-800 transition-colors shadow-xs"
                >
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>Use This Voice</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                </button>

                {/* [Record New Voice] */}
                <button
                  onClick={handleStartRecordNewVoiceFlow}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-100 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-zinc-600" />
                  <span>Record New Voice</span>
                </button>
              </div>

              {/* Section 10: Dedicated PUBLIC SURVEY VOICE TEST MODE Area */}
              <div className="mt-3 p-4 rounded-xl bg-gradient-to-r from-emerald-950 via-zinc-900 to-zinc-950 text-white border border-emerald-800/60 shadow-sm space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <h4 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                      <span>Voice Survey Test</span>
                      <span className="text-emerald-400 font-normal text-xs">/ వాయిస్ సర్వే టెస్ట్</span>
                    </h4>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5 animate-ping"></span>
                    Status: Active
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-zinc-400">Active Voice: </span>
                    <span className="font-semibold text-white">
                      {activeProfile?.metadata?.elevenlabs_name || `Client Voice (${activeProfile?.voice_id || 'Active'})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400">Status: </span>
                    <span className="font-semibold text-emerald-400">Active (క్లోన్ వాయిస్ సిద్ధంగా ఉంది)</span>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-300 leading-relaxed">
                  ఈ బటన్ నొక్కినప్పుడు లైవ్ ఫోన్ కాల్ లేకుండానే సర్వే టెస్ట్ ప్రారంభమవుతుంది. OpenAI సమాధానాన్ని సిద్ధం చేస్తుంది, ElevenLabs మీ క్లోన్ చేసిన వాయిస్‌తో దాన్ని పలుకుతుంది.
                </p>

                <div className="pt-1">
                  <button
                    onClick={handleUseThisVoiceForSurvey}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 transition-all shadow-md hover:scale-[1.01]"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start Voice Survey Test</span>
                    <span className="text-[11px] font-normal opacity-80">(వాయిస్ సర్వే టెస్ట్ ప్రారంభించండి)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* FLOW C: FIRST TIME OR RECORDING IN PROGRESS OR RECORDED PENDING CREATION  */}
          {/* ========================================================================= */}
          {(!hasSavedVoice || flowMode === 'recording_new') && !candidateVoice && (
            <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-4">
              {!hasSavedVoice && (
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-bold text-zinc-800">
                      వాయిస్ ఇంకా save కాలేదు.
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-500 font-medium">
                    మొదటిసారి వాయిస్ నమోదు (First-time recording)
                  </span>
                </div>
              )}

              {flowMode === 'recording_new' && (
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-zinc-200 pb-2">
                  <span className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-emerald-700" />
                    కొత్త వాయిస్ రికార్డింగ్ (Recording New Voice)
                  </span>
                  <button
                    onClick={() => {
                      setFlowMode('normal');
                      setRecordedBlob(null);
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-800 underline"
                  >
                    రద్దు చేయి (Cancel)
                  </button>
                </div>
              )}

              {/* State 1: Active Microphone Recording in Progress */}
              {isRecording && (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-center space-y-3 animate-pulse">
                  <div className="flex items-center justify-center gap-2 text-red-700 font-bold text-sm">
                    <span className="w-3 h-3 rounded-full bg-red-600 animate-ping"></span>
                    <span>Recording...</span>
                  </div>

                  {/* Formatted Timer: 00:01, 00:02, 00:03... */}
                  <div className="text-3xl font-mono font-bold tracking-widest text-red-900">
                    {formatTimer(recordingSeconds)}
                  </div>

                  <p className="text-xs text-red-700">
                    మీరు తెలుగులో ఏదైనా ఒక వాక్యం స్పష్టంగా మాట్లాడండి (ఉదా: "నమస్కారం, నా పేరు రాజు. నేను ప్రజా సమస్యల గురించి మాట్లాడాలనుకుంటున్నాను.")
                  </p>

                  <div>
                    {/* [Stop Recording] button */}
                    <button
                      onClick={handleStopRecording}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold bg-red-700 text-white hover:bg-red-800 transition-colors shadow-md"
                    >
                      <Square className="w-4 h-4 fill-current" />
                      <span>Stop Recording</span>
                    </button>
                  </div>
                </div>
              )}

              {/* State 2: Stopped Recording -> Ready for Play Recording, Record Again, Create Voice */}
              {!isRecording && recordedBlob && (
                <div className="p-4 rounded-lg bg-emerald-50/60 border border-emerald-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileAudio className="w-4 h-4 text-emerald-700" />
                      <span className="text-xs font-semibold text-emerald-950">
                        ఆడియో రికార్డింగ్ పూర్తయింది ({formatTimer(recordingSeconds)})
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {(recordedBlob.size / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600">
                    మీ రికార్డింగ్‌ను ప్లే చేసి సరిచూసుకోండి. నచ్చితే "Create Voice" క్లిక్ చేసి ElevenLabs ద్వారా క్లోన్ చేయండి.
                  </p>

                  {/* Three required action buttons after stopping */}
                  <div className="flex items-center gap-2.5 flex-wrap pt-1">
                    {/* [Play Recording] */}
                    <button
                      onClick={handleTogglePlayRecording}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-zinc-800 text-white hover:bg-zinc-900 transition-colors shadow-xs"
                    >
                      {isPlayingRecording ? (
                        <>
                          <Pause className="w-4 h-4" />
                          <span>ఆపు (Pause)</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          <span>Play Recording</span>
                        </>
                      )}
                    </button>

                    {/* [Record Again] */}
                    <button
                      onClick={handleRecordAgain}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-100 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-zinc-600" />
                      <span>Record Again</span>
                    </button>

                    {/* [Create Voice] */}
                    <button
                      onClick={handleCreateVoice}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors shadow-xs disabled:opacity-50"
                    >
                      {isLoading ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          <span>క్లోనింగ్ జరుగుతోంది...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-emerald-300" />
                          <span>Create Voice</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* State 3: Idle (Not recording, no pending recorded blob yet) */}
              {!isRecording && !recordedBlob && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-zinc-600 space-y-1">
                    <p className="font-medium text-zinc-900">
                      మీ వాయిస్ రికార్డ్ చేయడానికి సిద్ధంగా ఉండండి:
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      కనీసం 5-15 సెకన్ల పాటు స్పష్టంగా మాట్లాడండి లేదా సిద్ధంగా ఉన్న ఆడియో ఫైల్‌ను అప్‌లోడ్ చేయండి.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                    {/* [Record Voice] button */}
                    <button
                      onClick={handleStartRecording}
                      disabled={isLoading}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors shadow-xs disabled:opacity-50"
                    >
                      <Mic className="w-4 h-4" />
                      <span>Record Voice</span>
                    </button>

                    {/* [Use Sample Audio] demo option */}
                    <button
                      onClick={handleUseSampleAudio}
                      disabled={isLoading}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                      title="మైక్రోఫోన్ లేకుండానే పరీక్షించడానికి సిద్ధంగా ఉన్న నమూనా ఆడియోను ఉపయోగించండి"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                      <span>నమూనా ఆడియో (Demo Sample)</span>
                    </button>

                    {/* [Upload Audio] option */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm"
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-100 transition-colors disabled:opacity-50"
                      title="కంప్యూటర్ నుండి ఆడియో ఫైల్ అప్‌లోడ్ చేయండి"
                    >
                      <Upload className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Upload Audio</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION FOOTER: VOICE TEST STATUS & SURVEY INTEGRATION GUIDE              */}
          {/* ========================================================================= */}
          <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-500 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                రక్షణ: ElevenLabs API కీ సర్వర్ వద్ద మాత్రమే సురక్షితంగా ఉంటుంది (Client-safe).
              </span>
            </div>
            {hasSavedVoice && (
              <div className="flex items-center gap-1.5 text-emerald-800 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>
                  సర్వేలో సమాధానం ఇచ్చేటప్పుడు ఈ సేవ్ చేసిన వాయిస్ ఉపయోగించబడుతుంది.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
