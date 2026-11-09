import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { voiceProfileStorage } from './voiceProfileStorage';
import { ElevenLabsService } from './elevenLabsService';
import { VoiceProfile } from './types';

export const voiceRouter = express.Router();

// Supported audio MIME types and extensions
const SUPPORTED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/x-flac',
]);

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.webm',
  '.flac',
]);

// 15MB file size limit for voice samples
const MAX_FILE_SIZE = 15 * 1024 * 1024;

// Configure multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();

    if (SUPPORTED_MIME_TYPES.has(mime) || SUPPORTED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported audio format (${file.mimetype || ext}). Supported formats: mp3, wav, m4a, ogg, webm, flac, aac.`
        )
      );
    }
  },
});

function isValidAudioFormat(mimeType: string, fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  const mime = mimeType.toLowerCase();
  return SUPPORTED_MIME_TYPES.has(mime) || SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * GET /api/voice-profile/active/:client_id
 * or GET /api/voice-profile/client/:client_id
 *
 * Check whether an active voice already exists for this client.
 * Returns:
 * If active voice exists:
 *   "మీ voice ఇప్పటికే save అయి ఉంది."
 *   status: "active"
 * If no active voice exists:
 *   "వాయిస్ ఇంకా save కాలేదు."
 */
const handleGetActiveVoice = async (req: Request, res: Response) => {
  try {
    const clientId = (req.params.client_id || (req.query?.client_id as string) || 'client_001').trim();
    const activeProfile = await voiceProfileStorage.getActiveProfile(clientId);
    const allProfiles = await voiceProfileStorage.getProfilesByClientId(clientId);

    if (activeProfile && activeProfile.status === 'active') {
      return res.status(200).json({
        success: true,
        has_active_voice: true,
        message: 'మీ voice ఇప్పటికే save అయి ఉంది.',
        voice_status: 'Active',
        profile: {
          client_id: activeProfile.client_id,
          voice_id: activeProfile.voice_id,
          provider: 'elevenlabs',
          status: 'active',
          created_at: activeProfile.created_at,
          updated_at: activeProfile.updated_at,
          metadata: activeProfile.metadata,
        },
        all_voices: allProfiles,
      });
    }

    return res.status(200).json({
      success: true,
      has_active_voice: false,
      message: 'వాయిస్ ఇంకా save కాలేదు.',
      voice_status: 'Not Saved',
      profile: null,
      all_voices: allProfiles,
    });
  } catch (err: any) {
    console.error('Error in GET active voice profile:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to check active voice profile',
    });
  }
};

voiceRouter.get('/active/:client_id', handleGetActiveVoice);
voiceRouter.get('/client/:client_id', handleGetActiveVoice);

// GET /api/voice-profile/sample-audio
// Serves ready-to-use audio sample for quick voice cloning when microphone is unavailable/blocked
voiceRouter.get('/sample-audio', (_req: Request, res: Response) => {
  const fixturePath = path.join(process.cwd(), 'test-fixtures', 'sample_voice_sample.wav');
  if (fs.existsSync(fixturePath)) {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'inline; filename="telugu_sample_voice.wav"');
    return res.sendFile(fixturePath);
  }
  const fallbackBuffer = ElevenLabsService.generateFallbackWavBuffer('నమస్కారం');
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', fallbackBuffer.length.toString());
  res.setHeader('Content-Disposition', 'inline; filename="telugu_sample_voice.wav"');
  return res.send(fallbackBuffer);
});

/**
 * POST /api/voice-profile/create
 *
 * Receives client audio recording, calls ElevenLabs Instant Voice Cloning,
 * saves profile with:
 * client_id, voice_id, provider: 'elevenlabs', status: 'active' (or candidate),
 * generates short preview and returns safe status information.
 */
voiceRouter.post(
  '/create',
  (req, res, next) => {
    (upload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'file', maxCount: 1 },
    ]) as any)(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: `Audio file is too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
          });
        }
        return res.status(400).json({
          success: false,
          error: `Upload error: ${err.message}`,
        });
      } else if (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
        });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      // 1. Validate client_id
      const clientId = (req.body?.client_id || req.body?.user_id || req.query?.client_id || 'client_001').toString().trim();
      const isRecordNewVoiceMode = req.body?.mode === 'new_recording' || req.query?.mode === 'new_recording';

      let audioBuffer: Buffer | null = null;
      let fileName = 'client_recording.mp3';
      let mimeType = 'audio/mpeg';

      // Check if file was uploaded via multipart/form-data
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const uploadedFile = files?.audio?.[0] || files?.file?.[0];

      if (uploadedFile) {
        audioBuffer = uploadedFile.buffer;
        fileName = uploadedFile.originalname || 'client_recording.mp3';
        mimeType = uploadedFile.mimetype || 'audio/mpeg';
      } else if (req.body?.audio_base64) {
        const base64Data = req.body.audio_base64.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
        audioBuffer = Buffer.from(base64Data, 'base64');
        fileName = req.body.file_name || 'client_recording.mp3';
        mimeType = req.body.mime_type || 'audio/mpeg';
      }

      // 2. Validate audio
      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Audio recording file is required. Record via microphone or upload an audio file.',
        });
      }

      if (!isValidAudioFormat(mimeType, fileName)) {
        return res.status(400).json({
          success: false,
          error: `Unsupported audio format (${mimeType}). Supported formats: mp3, wav, m4a, ogg, webm, flac, aac.`,
        });
      }

      const voiceName = req.body?.voice_name || `Client_${clientId}_Voice_${Date.now()}`;
      const description = req.body?.description || `Telugu Public Survey cloned voice for ${clientId}`;

      // 3. Call ElevenLabs Instant Voice Cloning with server-side key
      const allowSimulation =
        req.headers['x-mock-elevenlabs'] === 'true' ||
        req.query?.mock === 'true' ||
        req.body?.mock === true;

      const cloneResult = await ElevenLabsService.cloneVoice({
        clientId,
        userId: clientId,
        voiceName,
        audioBuffer,
        fileName,
        mimeType,
        description,
        allowSimulation,
      });

      const newVoiceId = cloneResult.voice_id;

      // Check if client currently has an active voice
      const existingActive = await voiceProfileStorage.getActiveProfile(clientId);

      // Determine initial status:
      // If this is a returning client choosing "Record New Voice", do NOT delete or deactivate old voice immediately!
      // Create new voice first, generate preview, let user choose [Use New Voice] or [Keep Previous Voice].
      let initialStatus: 'active' | 'archived' = 'active';
      if (existingActive && existingActive.status === 'active' && isRecordNewVoiceMode) {
        // Save as candidate / archived until user clicks "Use New Voice"
        initialStatus = 'archived';
      }

      const now = new Date().toISOString();
      const profile: VoiceProfile = {
        client_id: clientId,
        user_id: clientId,
        voice_id: newVoiceId,
        provider: 'elevenlabs',
        status: initialStatus,
        voice_status: initialStatus === 'active' ? 'ready' : 'pending_review',
        created_at: now,
        updated_at: now,
        preview_audio_url: `/api/voice-profile/preview-audio/${encodeURIComponent(newVoiceId)}`,
        metadata: {
          original_filename: fileName,
          file_size_bytes: audioBuffer.length,
          mime_type: mimeType,
          description,
          elevenlabs_name: voiceName,
          is_mock: cloneResult.isMock || false,
        },
      };

      await voiceProfileStorage.saveProfile(profile);

      return res.status(200).json({
        success: true,
        client_id: clientId,
        voice_id: newVoiceId,
        provider: 'elevenlabs',
        status: profile.status,
        voice_status: profile.voice_status,
        is_new_candidate: isRecordNewVoiceMode && Boolean(existingActive),
        previous_voice_id: existingActive?.voice_id || null,
        preview_url: `/api/voice-profile/preview-audio/${encodeURIComponent(newVoiceId)}`,
        preview_text: 'నమస్కారం అండి. మీ ప్రాంతంలోని ప్రజా సదుపాయాల గురించి కొన్ని ప్రశ్నలు అడగడానికి కాల్ చేస్తున్నాము.',
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        message:
          isRecordNewVoiceMode && existingActive
            ? 'New voice preview is ready. Choose "Use New Voice" to activate or "Keep Previous Voice".'
            : 'వాయిస్ క్లోన్ చేయబడి విజయవంతంగా save అయింది.',
      });
    } catch (err: any) {
      console.error('Error in POST /api/voice-profile/create:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'Voice cloning failed',
      });
    }
  }
);

/**
 * POST /api/voice-profile/activate
 *
 * When user selects [Use New Voice] or [Use This Voice]:
 * old voice = archived
 * new voice = active
 */
voiceRouter.post('/activate', async (req: Request, res: Response) => {
  try {
    const clientId = (req.body?.client_id || req.body?.user_id || 'client_001').trim();
    const voiceId = (req.body?.voice_id || '').trim();

    if (!voiceId) {
      return res.status(400).json({
        success: false,
        error: 'voice_id is required to activate a voice',
      });
    }

    const activated = await voiceProfileStorage.activateVoice(clientId, voiceId);

    return res.status(200).json({
      success: true,
      message: 'వాయిస్ విజయవంతంగా యాక్టివేట్ చేయబడింది.',
      profile: {
        client_id: activated.client_id,
        voice_id: activated.voice_id,
        provider: 'elevenlabs',
        status: 'active',
        created_at: activated.created_at,
        updated_at: activated.updated_at,
      },
    });
  } catch (err: any) {
    console.error('Error in POST /api/voice-profile/activate:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to activate voice',
    });
  }
});

/**
 * POST /api/voice-profile/keep-previous
 *
 * When user selects [Keep Previous Voice]:
 * old voice remains active.
 * candidate voice is archived.
 */
voiceRouter.post('/keep-previous', async (req: Request, res: Response) => {
  try {
    const clientId = (req.body?.client_id || req.body?.user_id || 'client_001').trim();
    const candidateVoiceId = (req.body?.candidate_voice_id || req.body?.new_voice_id || '').trim();

    const activeProfile = await voiceProfileStorage.keepPreviousVoice(clientId, candidateVoiceId);

    return res.status(200).json({
      success: true,
      message: 'మునుపటి వాయిస్ యాక్టివ్‌గా కొనసాగించబడింది.',
      active_voice_id: activeProfile?.voice_id || null,
      profile: activeProfile,
    });
  } catch (err: any) {
    console.error('Error in POST /api/voice-profile/keep-previous:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to keep previous voice',
    });
  }
});

/**
 * GET /api/voice-profile/preview-audio/:voice_id
 *
 * Streams short preview audio in Telugu for direct browser <audio> playback.
 */
voiceRouter.get('/preview-audio/:voice_id', async (req: Request, res: Response) => {
  try {
    const voiceId = req.params.voice_id.trim();
    const text =
      (req.query?.text as string) ||
      'నమస్కారం అండి. మీ ప్రాంతంలోని ప్రజా సదుపాయాల గురించి కొన్ని ప్రశ్నలు అడగడానికి కాల్ చేస్తున్నాము.';

    const { buffer, contentType, isMock } = await ElevenLabsService.generatePreview(voiceId, text);

    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'X-Voice-Id': voiceId,
      'X-Is-Mock': isMock ? 'true' : 'false',
      'Cache-Control': 'no-cache',
    });

    return res.send(buffer);
  } catch (err: any) {
    console.error('Error generating preview audio:', err);
    // Provide fallback WAV so browser audio element never errors
    const fallback = ElevenLabsService.generateFallbackWavBuffer();
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': fallback.length });
    return res.send(fallback);
  }
});

/**
 * POST /api/voice-profile/preview
 *
 * Generates speech preview for a given voice_id.
 */
voiceRouter.post('/preview', async (req: Request, res: Response) => {
  try {
    const voiceId = (req.body?.voice_id || '').trim();
    const text =
      req.body?.text?.trim() ||
      'నమస్కారం అండి. మీ ప్రాంతంలోని ప్రజా సదుపాయాల గురించి కొన్ని ప్రశ్నలు అడగడానికి కాల్ చేస్తున్నాము.';

    if (!voiceId) {
      return res.status(400).json({ success: false, error: 'voice_id is required' });
    }

    const { buffer, contentType, isMock } = await ElevenLabsService.generatePreview(voiceId, text);

    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'X-Voice-Id': voiceId,
      'X-Is-Mock': isMock ? 'true' : 'false',
    });

    return res.send(buffer);
  } catch (err: any) {
    console.error('Error in /api/voice-profile/preview:', err);
    const fallback = ElevenLabsService.generateFallbackWavBuffer();
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': fallback.length });
    return res.send(fallback);
  }
});

/**
 * POST /api/voice-profile/tts
 * and GET /api/voice-profile/tts-audio
 *
 * Core ElevenLabs TTS endpoint for the Public Survey Agent:
 * Takes Telugu response text and converts it into speech using the client's cloned voice!
 */
const handleTtsPlayback = async (req: Request, res: Response) => {
  try {
    const clientId = (req.body?.client_id || req.query?.client_id || 'client_001').toString().trim();
    let voiceId = (req.body?.voice_id || req.query?.voice_id || '').toString().trim();
    const text = (req.body?.text || req.query?.text || '').toString().trim();

    if (!text) {
      return res.status(400).json({ success: false, error: 'text is required for speech synthesis' });
    }

    // If voice_id not directly provided, retrieve active voice for this client
    if (!voiceId) {
      const active = await voiceProfileStorage.getActiveProfile(clientId);
      if (active) {
        voiceId = active.voice_id;
      }
    }

    if (!voiceId) {
      voiceId = 'voice_client_001_default';
    }

    const { buffer, contentType, isMock } = await ElevenLabsService.synthesizeSpeech(voiceId, text);

    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'X-Voice-Id': voiceId,
      'X-Client-Id': clientId,
      'X-Is-Mock': isMock ? 'true' : 'false',
      'Cache-Control': 'no-cache',
    });

    return res.send(buffer);
  } catch (err: any) {
    console.error('Error in TTS playback:', err);
    const fallback = ElevenLabsService.generateFallbackWavBuffer(req.body?.text || (req.query?.text as string));
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': fallback.length });
    return res.send(fallback);
  }
};

voiceRouter.post('/tts', handleTtsPlayback);
voiceRouter.get('/tts-audio', handleTtsPlayback);

// =========================================================================
// BACKWARD COMPATIBILITY ENDPOINTS (Existing suite tests & endpoints)
// =========================================================================

/**
 * POST /api/voice-profile
 * Standard multipart or json voice creation endpoint
 */
voiceRouter.post(
  '/',
  (req, res, next) => {
    (upload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'file', maxCount: 1 },
    ]) as any)(req, res, (err: any) => {
      if (err) return res.status(400).json({ success: false, error: err.message });
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const rawId = req.body?.user_id || req.body?.client_id || req.query?.user_id;
      if (!rawId || !rawId.toString().trim()) {
        return res.status(400).json({ success: false, error: 'user_id is required' });
      }
      const userId = rawId.toString().trim();
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const uploadedFile = files?.audio?.[0] || files?.file?.[0];

      let audioBuffer: Buffer | null = null;
      let fileName = 'recording.mp3';
      let mimeType = 'audio/mpeg';

      if (uploadedFile) {
        audioBuffer = uploadedFile.buffer;
        fileName = uploadedFile.originalname || 'recording.mp3';
        mimeType = uploadedFile.mimetype || 'audio/mpeg';
      } else if (req.body?.audio_base64) {
        const base64Data = req.body.audio_base64.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
        audioBuffer = Buffer.from(base64Data, 'base64');
        fileName = req.body.file_name || 'recording.mp3';
        mimeType = req.body.mime_type || 'audio/mpeg';
      }

      if (!audioBuffer) {
        return res.status(400).json({ success: false, error: 'Audio file required' });
      }

      const cloneResult = await ElevenLabsService.cloneVoice({
        userId,
        clientId: userId,
        voiceName: req.body?.voice_name || `User_${userId}_Voice`,
        audioBuffer,
        fileName,
        mimeType,
        description: req.body?.description || `Voice clone for ${userId}`,
        allowSimulation: req.headers['x-mock-elevenlabs'] === 'true' || req.query?.mock === 'true',
      });

      const profile: VoiceProfile = {
        client_id: userId,
        user_id: userId,
        voice_id: cloneResult.voice_id,
        provider: 'elevenlabs',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        voice_status: 'ready',
        metadata: {
          original_filename: fileName,
          file_size_bytes: audioBuffer.length,
          mime_type: mimeType,
          is_mock: cloneResult.isMock || false,
        },
      };

      await voiceProfileStorage.saveProfile(profile);

      return res.status(200).json({
        success: true,
        user_id: userId,
        client_id: userId,
        voice_id: cloneResult.voice_id,
        status: 'voice_profile_created',
        voice_status: profile.voice_status,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Cloning failed' });
    }
  }
);

voiceRouter.get('/:user_id', async (req: Request, res: Response) => {
  try {
    const userId = req.params.user_id.trim();
    const profile = await voiceProfileStorage.getActiveProfile(userId);
    if (!profile) {
      return res.status(404).json({ success: false, error: `Voice profile not found for: ${userId}` });
    }
    return res.status(200).json({
      success: true,
      user_id: profile.user_id,
      client_id: profile.client_id,
      voice_id: profile.voice_id,
      provider: profile.provider,
      status: profile.status,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      metadata: profile.metadata,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

voiceRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const profiles = await voiceProfileStorage.listProfiles();
    return res.status(200).json({
      success: true,
      count: profiles.length,
      profiles,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

voiceRouter.post('/:user_id/test-tts', async (req: Request, res: Response) => {
  try {
    const userId = req.params.user_id.trim();
    const text = req.body?.text?.trim() || 'నమస్కారం! మీ అభిప్రాయం తెలుసుకోవడానికి ఈ సర్వే చేస్తున్నాము.';
    const profile = await voiceProfileStorage.getActiveProfile(userId);
    if (!profile) {
      return res.status(404).json({ success: false, error: `Voice profile not found for ${userId}` });
    }
    const { buffer, contentType } = await ElevenLabsService.synthesizeSpeech(profile.voice_id, text);
    res.set({ 'Content-Type': contentType, 'Content-Length': buffer.length });
    return res.send(buffer);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

voiceRouter.delete('/:user_id', async (req: Request, res: Response) => {
  try {
    const userId = req.params.user_id.trim();
    const deleted = await voiceProfileStorage.deleteProfile(userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Voice profile not found for: ${userId}` });
    }
    return res.status(200).json({ success: true, message: `Voice profile deleted for ${userId}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

voiceRouter.post('/internal-test', async (req: Request, res: Response) => {
  const fixturePath = path.join(process.cwd(), 'test-fixtures', 'sample_voice_sample.wav');
  if (!fs.existsSync(fixturePath)) {
    return res.status(500).json({ status: 'FAILED', error: 'Fixture not found' });
  }
  const audioBuffer = fs.readFileSync(fixturePath);
  const testUserId = `test_live_user_${Date.now()}`;
  try {
    const cloneResult = await ElevenLabsService.cloneVoice({
      userId: testUserId,
      voiceName: `InternalTest_${testUserId}`,
      audioBuffer,
      fileName: 'sample_voice_sample.wav',
      mimeType: 'audio/wav',
      allowSimulation: false,
    });
    return res.status(200).json({
      status: 'SUCCESS',
      voice_id: cloneResult.voice_id,
      user_id: testUserId,
    });
  } catch (err: any) {
    return res.status(200).json({ status: 'FAILED', exact_elevenlabs_error: err?.message });
  }
});
