export type VoiceStatus = 'active' | 'archived' | 'ready' | 'processing' | 'failed' | 'pending_review';

export interface VoiceProfile {
  client_id: string;
  user_id?: string; // alias for backward compatibility
  voice_id: string;
  provider: 'elevenlabs';
  status: 'active' | 'archived';
  voice_status?: VoiceStatus;
  created_at: string;
  updated_at: string;
  preview_audio_url?: string;
  metadata?: {
    original_filename?: string;
    file_size_bytes?: number;
    mime_type?: string;
    description?: string;
    elevenlabs_name?: string;
    is_mock?: boolean;
    [key: string]: any;
  };
}

export interface VoiceCloneInput {
  clientId?: string;
  userId?: string;
  voiceName?: string;
  audioBuffer: Buffer;
  fileName: string;
  mimeType: string;
  description?: string;
  allowSimulation?: boolean;
}

export interface VoiceCloneResult {
  success: boolean;
  client_id: string;
  user_id?: string;
  voice_id?: string;
  provider: 'elevenlabs';
  status: 'active' | 'archived';
  error?: string;
  is_mock?: boolean;
}

export interface IVoiceProfileStorage {
  saveProfile(profile: VoiceProfile): Promise<VoiceProfile>;
  getActiveProfile(clientId: string): Promise<VoiceProfile | null>;
  getProfileByVoiceId(voiceId: string): Promise<VoiceProfile | null>;
  getProfilesByClientId(clientId: string): Promise<VoiceProfile[]>;
  activateVoice(clientId: string, voiceId: string): Promise<VoiceProfile>;
  keepPreviousVoice(clientId: string, candidateVoiceId: string): Promise<VoiceProfile | null>;
  getProfileByUserId(userId: string): Promise<VoiceProfile | null>;
  listProfiles(): Promise<VoiceProfile[]>;
  deleteProfile(userIdOrClientId: string): Promise<boolean>;
}
