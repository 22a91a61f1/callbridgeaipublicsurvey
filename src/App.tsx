import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  SurveyConfig,
  ChatMessage,
  CapturedAnswer,
  AgentTurnResponse,
  ClientVoiceProfile,
} from './types';
import { PRESET_SURVEYS } from './presetSurveys';
import { Header } from './components/Header';
import { ChatFeed } from './components/ChatFeed';
import { InputBar } from './components/InputBar';
import { SurveyConfigModal } from './components/SurveyConfigModal';
import { RecordedResponsesModal } from './components/RecordedResponsesModal';
import { ClientVoiceSection } from './components/ClientVoiceSection';
import { speakText, stopSpeaking } from './utils/speech';

export default function App() {
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig>(PRESET_SURVEYS[0]);
  const [sessionId, setSessionId] = useState<string>(() => `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const [status, setStatus] = useState<'configuring' | 'active' | 'completed' | 'stopped'>('active');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [capturedAnswers, setCapturedAnswers] = useState<Record<string, CapturedAnswer>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true); // Voice playback enabled by default
  const [overallSummary, setOverallSummary] = useState<string>('');

  // Modals
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [isDataOpen, setIsDataOpen] = useState<boolean>(false);

  // Client Voice Profile & ElevenLabs Testing State
  const [activeVoiceProfile, setActiveVoiceProfile] = useState<ClientVoiceProfile | null>(null);
  const [useClonedVoiceForSurvey, setUseClonedVoiceForSurvey] = useState<boolean>(true);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState<boolean>(false);

  const activeAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const voiceSectionRef = useRef<HTMLDivElement | null>(null);

  // Stop any active speech (either Web Speech or cloned voice audio)
  const stopAgentSpeech = useCallback(() => {
    stopSpeaking();
    if (activeAudioElementRef.current) {
      activeAudioElementRef.current.pause();
      activeAudioElementRef.current = null;
    }
    setIsAgentSpeaking(false);
  }, []);

  // Play base64 audio stream directly from survey turn response
  const playAudioData = useCallback(
    async (audioBase64OrUrl: string, fallbackText: string) => {
      stopAgentSpeech();
      try {
        setIsAgentSpeaking(true);
        const audio = new Audio(audioBase64OrUrl);
        activeAudioElementRef.current = audio;

        audio.onended = () => {
          setIsAgentSpeaking(false);
        };

        audio.onerror = () => {
          setIsAgentSpeaking(false);
          speakText(fallbackText, 'Telugu', () => setIsAgentSpeaking(false));
        };

        await audio.play();
      } catch (err) {
        console.warn('Direct audio play error:', err);
        speakText(fallbackText, 'Telugu', () => setIsAgentSpeaking(false));
      }
    },
    [stopAgentSpeech]
  );

  // Play agent speech using ElevenLabs cloned voice when available, or Web Speech fallback
  const playAgentSpeech = useCallback(
    async (text: string) => {
      if (!text || !text.trim() || !autoSpeak) return;

      stopAgentSpeech();

      // Check if we should speak with the client's cloned voice via ElevenLabs
      if (useClonedVoiceForSurvey && activeVoiceProfile?.voice_id) {
        try {
          setIsAgentSpeaking(true);
          const res = await fetch('/api/voice-profile/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: activeVoiceProfile.client_id || 'client_001',
              voice_id: activeVoiceProfile.voice_id,
              text,
            }),
          });

          if (!res.ok) {
            throw new Error(`TTS synthesis returned status ${res.status}`);
          }

          const blob = await res.blob();
          const audioUrl = URL.createObjectURL(blob);
          const audio = new Audio(audioUrl);
          activeAudioElementRef.current = audio;

          audio.onended = () => {
            setIsAgentSpeaking(false);
            URL.revokeObjectURL(audioUrl);
          };

          audio.onerror = () => {
            setIsAgentSpeaking(false);
            URL.revokeObjectURL(audioUrl);
            speakText(text, 'Telugu', () => setIsAgentSpeaking(false));
          };

          await audio.play();
          return;
        } catch (err) {
          console.warn('ElevenLabs TTS audio error, falling back to local speech:', err);
        }
      }

      // Default fallback to Web Speech API
      setIsAgentSpeaking(true);
      speakText(text, 'Telugu', () => setIsAgentSpeaking(false));
    },
    [autoSpeak, useClonedVoiceForSurvey, activeVoiceProfile, stopAgentSpeech]
  );

  // Initialize or restart survey session strictly in Telugu
  const initSurveySession = useCallback(
    async (configToUse = surveyConfig) => {
      stopAgentSpeech();
      setIsLoading(true);
      setMessages([]);
      setCapturedAnswers({});
      setStatus('active');
      setOverallSummary('');

      // If survey questions are not configured yet, set clear authentic Telugu greeting directly
      if (!configToUse.questions || configToUse.questions.length === 0) {
        const readyMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'agent',
          text: 'నమస్కారం! ప్రస్తుతం ఈ సర్వేకు సంబంధించిన ప్రశ్నలు మరియు వివరాలు ఇంకా కాన్ఫిగర్ చేయబడలేదు. ప్రశ్నలు అందించిన తర్వాత సర్వేను ప్రారంభించడానికి నేను సిద్ధంగా ఉన్నాను.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages([readyMsg]);
        setIsLoading(false);
        if (autoSpeak) {
          playAgentSpeech(readyMsg.text);
        }
        return;
      }

      try {
        const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        setSessionId(newSessionId);

        const payloadConfig = {
          ...configToUse,
          targetLanguage: 'Telugu' as const,
        };

        const res = await fetch('/api/survey/interact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: newSessionId,
            messages: [],
            surveyConfig: payloadConfig,
            collectedAnswers: {},
            client_id: activeVoiceProfile?.client_id || 'client_001',
            voice_id: useClonedVoiceForSurvey ? activeVoiceProfile?.voice_id : undefined,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }

        const data: AgentTurnResponse = await res.json();

        const agentMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'agent',
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setMessages([agentMsg]);

        if (autoSpeak && data.reply) {
          if (useClonedVoiceForSurvey && data.audio_base64) {
            playAudioData(data.audio_base64, data.reply);
          } else {
            playAgentSpeech(data.reply);
          }
        }
      } catch (err) {
        console.warn('Failed to initialize survey:', err);
        const errorMsg: ChatMessage = {
          id: `msg-err-${Date.now()}`,
          role: 'agent',
          text: 'నమస్కారం. ప్రస్తుతం సర్వే ప్రశ్నలు ఇంకా కాన్ఫిగర్ చేయబడలేదు. దయచేసి సర్వే ప్రశ్నలు మరియు సంబంధిత సమాచారాన్ని అందించండి.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages([errorMsg]);
        if (autoSpeak) {
          playAgentSpeech(errorMsg.text);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [surveyConfig, autoSpeak, activeVoiceProfile, playAgentSpeech, stopAgentSpeech]
  );

  // Auto-init on mount
  useEffect(() => {
    initSurveySession(surveyConfig);
  }, []);

  // Handle user response
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading || status === 'completed' || status === 'stopped') {
      return;
    }

    stopAgentSpeech();

    const respondentMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'respondent',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...messages, respondentMsg];
    setMessages(newHistory);
    setIsLoading(true);

    try {
      // Build summary mapping for backend context
      const collectedMap: Record<string, string> = {};
      Object.entries(capturedAnswers).forEach(([qid, val]) => {
        collectedMap[qid] = `${val.status}: ${val.answerSummary}`;
      });

      const res = await fetch('/api/survey/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          messages: newHistory,
          surveyConfig: {
            ...surveyConfig,
            targetLanguage: 'Telugu',
          },
          collectedAnswers: collectedMap,
          client_id: activeVoiceProfile?.client_id || 'client_001',
          voice_id: useClonedVoiceForSurvey ? activeVoiceProfile?.voice_id : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned error: ${res.status}`);
      }

      const data: AgentTurnResponse = await res.json();

      let statusTag: ChatMessage['statusTag'];
      if (data.isSurveyComplete) {
        statusTag = 'completed';
      } else if (data.isSurveyStopped) {
        statusTag = 'stopped';
      }

      const agentMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'agent',
        text: data.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        statusTag,
      };

      setMessages((prev) => [...prev, agentMsg]);

      // Update captured answers
      if (data.extractedAnswers && Array.isArray(data.extractedAnswers)) {
        setCapturedAnswers((prev) => {
          const updated = { ...prev };
          data.extractedAnswers?.forEach((ea) => {
            const questionMatch = surveyConfig.questions.find((q) => q.id === ea.questionId);
            updated[ea.questionId] = {
              questionId: ea.questionId,
              questionText: questionMatch?.text || `ప్రశ్న ${ea.questionId}`,
              answerSummary: ea.answerSummary,
              status: ea.status,
            };
          });
          return updated;
        });
      }

      if (data.isSurveyComplete) {
        setStatus('completed');
        if (data.summaryOfCollected) {
          setOverallSummary(data.summaryOfCollected);
        }
      } else if (data.isSurveyStopped) {
        setStatus('stopped');
      }

      if (autoSpeak && data.reply) {
        if (useClonedVoiceForSurvey && data.audio_base64) {
          playAudioData(data.audio_base64, data.reply);
        } else {
          playAgentSpeech(data.reply);
        }
      }
    } catch (err) {
      console.warn('Error during interaction:', err);
      const agentErrMsg: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: 'agent',
        text: 'క్షమించండి, కనెక్షన్‌లో చిన్న అంతరాయం కలిగింది. దయచేసి మీరు ఇందాక అన్నది మరోసారి చెప్పగలరా?',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, agentErrMsg]);
      if (autoSpeak) {
        playAgentSpeech(agentErrMsg.text);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyConfig = (newConfig: SurveyConfig) => {
    setSurveyConfig(newConfig);
    initSurveySession(newConfig);
  };

  const handleVoiceActivated = (profile: ClientVoiceProfile) => {
    setActiveVoiceProfile(profile);
    setUseClonedVoiceForSurvey(true);
  };

  const handleJumpToVoiceSection = () => {
    voiceSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const addressedCount = Object.values(capturedAnswers).filter(
    (a) => a.status === 'answered' || a.status === 'refused'
  ).length;

  const hasQuestions = surveyConfig.questions.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-zinc-100 text-zinc-900 selection:bg-emerald-900 selection:text-white antialiased font-sans">
      {/* Top Header with Active Cloned Voice Badge */}
      <Header
        surveyTitle={surveyConfig.title}
        status={status}
        onOpenConfig={() => setIsConfigOpen(true)}
        onOpenData={() => setIsDataOpen(true)}
        onReset={() => initSurveySession(surveyConfig)}
        autoSpeak={autoSpeak}
        onToggleAutoSpeak={() => {
          stopAgentSpeech();
          setAutoSpeak((prev) => !prev);
        }}
        totalQuestions={surveyConfig.questions.length}
        addressedQuestionsCount={addressedCount}
        hasQuestions={hasQuestions}
        activeVoiceId={activeVoiceProfile?.voice_id}
        onJumpToVoiceSection={handleJumpToVoiceSection}
      />

      {/* Main Container */}
      <main className="flex-1 flex flex-col max-w-5xl w-full mx-auto bg-white/90 sm:border-x border-zinc-200 shadow-xs relative">
        {/* Clearly Visible Section: Client Voice / క్లయింట్ వాయిస్ */}
        <div ref={voiceSectionRef} id="client-voice-section">
          <ClientVoiceSection
            clientId="client_001"
            activeProfile={activeVoiceProfile}
            onVoiceActivated={handleVoiceActivated}
            useClonedVoiceForSurvey={useClonedVoiceForSurvey}
            onToggleUseClonedVoice={setUseClonedVoiceForSurvey}
            isAgentSpeaking={isAgentSpeaking}
            onStartSurveyTest={() => {
              if (messages.length <= 1) {
                initSurveySession(surveyConfig);
              }
            }}
          />
        </div>

        {/* Conversational Feed with Cloned Voice Replay capability */}
        <ChatFeed
          messages={messages}
          isLoading={isLoading}
          language="Telugu"
          surveyComplete={status === 'completed'}
          surveyStopped={status === 'stopped'}
          hasQuestions={hasQuestions}
          onOpenData={() => setIsDataOpen(true)}
          onRestart={() => initSurveySession(surveyConfig)}
          onOpenConfig={() => setIsConfigOpen(true)}
          onPlayMessageAudio={(text) => playAgentSpeech(text)}
          activeVoiceId={useClonedVoiceForSurvey ? activeVoiceProfile?.voice_id : null}
        />

        {/* Bottom Input Area with Microphone, Textbox & Quick Telugu Testing Pills */}
        <InputBar
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          disabled={status === 'completed' || status === 'stopped'}
        />
      </main>

      {/* Survey Setup & Knowledge Base Modal */}
      <SurveyConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        currentConfig={surveyConfig}
        onApplyConfig={handleApplyConfig}
      />

      {/* Collected Data & Full Transcript Modal */}
      <RecordedResponsesModal
        isOpen={isDataOpen}
        onClose={() => setIsDataOpen(false)}
        surveyConfig={surveyConfig}
        capturedAnswers={capturedAnswers}
        messages={messages}
        overallSummary={overallSummary}
      />
    </div>
  );
}
