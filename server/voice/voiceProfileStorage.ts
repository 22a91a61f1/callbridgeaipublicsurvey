import fs from 'fs';
import path from 'path';
import { VoiceProfile, IVoiceProfileStorage } from './types';

/**
 * File-backed Voice Profile Storage.
 *
 * Implements a clean, decoupled abstraction for client voice profiles:
 * - client_id -> voice_id
 * - provider: 'elevenlabs'
 * - status: 'active' | 'archived'
 * - created_at, updated_at
 *
 * Stored format matching project requirements:
 * {
 *   "client_id": "client_001",
 *   "provider": "elevenlabs",
 *   "voice_id": "voice_abc123",
 *   "status": "active",
 *   "created_at": "...",
 *   "updated_at": "..."
 * }
 */
export class JsonFileVoiceProfileStorage implements IVoiceProfileStorage {
  private profiles: Map<string, VoiceProfile> = new Map(); // key: voice_id
  private storageFilePath: string;

  constructor(storageDir = path.join(process.cwd(), 'data')) {
    try {
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    } catch (err) {
      console.warn('Could not create storage directory for voice profiles:', err);
    }
    this.storageFilePath = path.join(storageDir, 'voice_profiles.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const data: any[] = JSON.parse(raw);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item && (item.voice_id || item.user_id || item.client_id)) {
              const voiceId = item.voice_id || `voice_${item.user_id || item.client_id}`;
              const clientId = item.client_id || item.user_id || 'client_001';
              const profile: VoiceProfile = {
                client_id: clientId,
                user_id: item.user_id || clientId,
                voice_id: voiceId,
                provider: item.provider || 'elevenlabs',
                status: item.status === 'archived' ? 'archived' : 'active',
                voice_status: item.voice_status || 'ready',
                created_at: item.created_at || new Date().toISOString(),
                updated_at: item.updated_at || new Date().toISOString(),
                preview_audio_url: item.preview_audio_url,
                metadata: item.metadata || {},
              };
              this.profiles.set(voiceId, profile);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Could not read existing voice_profiles.json:', err);
    }
  }

  private persistToDisk(): void {
    try {
      const data = Array.from(this.profiles.values());
      fs.writeFileSync(this.storageFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Could not write voice_profiles.json to disk:', err);
    }
  }

  async saveProfile(profile: VoiceProfile): Promise<VoiceProfile> {
    const existing = this.profiles.get(profile.voice_id);
    const now = new Date().toISOString();
    const clientId = profile.client_id || profile.user_id || 'client_001';

    const normalized: VoiceProfile = {
      client_id: clientId,
      user_id: profile.user_id || clientId,
      voice_id: profile.voice_id,
      provider: profile.provider || 'elevenlabs',
      status: profile.status || 'active',
      voice_status: profile.voice_status || (profile.status === 'active' ? 'ready' : 'archived'),
      created_at: existing ? existing.created_at : profile.created_at || now,
      updated_at: now,
      preview_audio_url: profile.preview_audio_url || existing?.preview_audio_url,
      metadata: {
        ...(existing?.metadata || {}),
        ...(profile.metadata || {}),
      },
    };

    // If this profile is being set as active, archive other voices for this client
    if (normalized.status === 'active') {
      for (const [vId, p] of this.profiles.entries()) {
        if (p.client_id === clientId && vId !== normalized.voice_id && p.status === 'active') {
          this.profiles.set(vId, {
            ...p,
            status: 'archived',
            voice_status: 'archived',
            updated_at: now,
          });
        }
      }
    }

    this.profiles.set(normalized.voice_id, normalized);
    this.persistToDisk();
    return normalized;
  }

  async getActiveProfile(clientId: string): Promise<VoiceProfile | null> {
    const targetId = clientId.trim();
    // Look for active voice for this client
    for (const profile of this.profiles.values()) {
      if ((profile.client_id === targetId || profile.user_id === targetId) && profile.status === 'active') {
        return { ...profile };
      }
    }
    // If no voice explicitly marked active, check if there's any profile for this client
    const clientProfiles = await this.getProfilesByClientId(targetId);
    if (clientProfiles.length > 0) {
      // Pick the most recent one
      const sorted = [...clientProfiles].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      return { ...sorted[0] };
    }
    return null;
  }

  async getProfileByVoiceId(voiceId: string): Promise<VoiceProfile | null> {
    const profile = this.profiles.get(voiceId.trim());
    return profile ? { ...profile } : null;
  }

  async getProfilesByClientId(clientId: string): Promise<VoiceProfile[]> {
    const targetId = clientId.trim();
    const result: VoiceProfile[] = [];
    for (const profile of this.profiles.values()) {
      if (profile.client_id === targetId || profile.user_id === targetId) {
        result.push({ ...profile });
      }
    }
    return result.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async activateVoice(clientId: string, voiceId: string): Promise<VoiceProfile> {
    const targetId = clientId.trim();
    const vId = voiceId.trim();
    const now = new Date().toISOString();

    let targetProfile = this.profiles.get(vId);
    if (!targetProfile) {
      // create new if not existing
      targetProfile = {
        client_id: targetId,
        user_id: targetId,
        voice_id: vId,
        provider: 'elevenlabs',
        status: 'active',
        created_at: now,
        updated_at: now,
      };
    }

    // Set other profiles of this client to archived
    for (const [id, p] of this.profiles.entries()) {
      if ((p.client_id === targetId || p.user_id === targetId) && id !== vId) {
        this.profiles.set(id, {
          ...p,
          status: 'archived',
          voice_status: 'archived',
          updated_at: now,
        });
      }
    }

    const activated: VoiceProfile = {
      ...targetProfile,
      client_id: targetId,
      status: 'active',
      voice_status: 'ready',
      updated_at: now,
    };

    this.profiles.set(vId, activated);
    this.persistToDisk();
    return activated;
  }

  async keepPreviousVoice(clientId: string, candidateVoiceId: string): Promise<VoiceProfile | null> {
    const targetId = clientId.trim();
    const now = new Date().toISOString();

    // Mark candidate voice as archived
    const candidate = this.profiles.get(candidateVoiceId.trim());
    if (candidate) {
      this.profiles.set(candidateVoiceId.trim(), {
        ...candidate,
        status: 'archived',
        voice_status: 'archived',
        updated_at: now,
      });
    }

    // Find or keep previous active voice
    const active = await this.getActiveProfile(targetId);
    this.persistToDisk();
    return active;
  }

  async getProfileByUserId(userId: string): Promise<VoiceProfile | null> {
    return this.getActiveProfile(userId);
  }

  async listProfiles(): Promise<VoiceProfile[]> {
    return Array.from(this.profiles.values()).map((p) => ({ ...p }));
  }

  async deleteProfile(userIdOrClientId: string): Promise<boolean> {
    const target = userIdOrClientId.trim();
    let deletedCount = 0;
    for (const [vId, p] of this.profiles.entries()) {
      if (p.client_id === target || p.user_id === target || p.voice_id === target) {
        this.profiles.delete(vId);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      this.persistToDisk();
      return true;
    }
    return false;
  }
}

// Global singleton instance for the backend
export const voiceProfileStorage: IVoiceProfileStorage = new JsonFileVoiceProfileStorage();
