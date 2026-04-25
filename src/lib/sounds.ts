/**
 * Sound notification utilities for session status events.
 * Plays sounds when sessions complete or need input.
 */

import {
  type NotificationSound,
  type CustomNotificationSound,
  customNotificationSoundOptions,
} from '../types/preferences'
import { invoke } from './transport'

const customSoundAssetMap: Record<CustomNotificationSound, string> = {
  workwork: '/sounds/work-work.mp3',
  jobsdone: '/sounds/jobs-done.mp3',
}

const SYSTEM_SOUND_PREFIX = 'system:'

// Single audio instance to prevent overlapping sounds
let currentAudio: HTMLAudioElement | null = null

// Audio context for system beep fallback (reused to avoid creating many contexts)
let audioContext: AudioContext | null = null

/**
 * Play a notification sound. If a sound is already playing, it will be stopped first.
 * Falls back to a system beep if the audio file is not found or playback fails.
 */
export function playNotificationSound(sound: NotificationSound): void {
  if (sound === 'none') return

  if (sound.startsWith(SYSTEM_SOUND_PREFIX)) {
    // System sounds are handed off to the OS — afplay/PowerShell/paplay — because
    // the WebView can't decode AIFF (and we don't want to ship per-codec polyfills).
    const id = sound.slice(SYSTEM_SOUND_PREFIX.length)
    invoke<null>('play_system_sound', { id }).catch(() => {
      // Sound id not found on this OS (e.g. saved on macOS, opened on Linux) — fall
      // back to a synthesized beep so the user still gets some audio cue.
      playSystemBeep()
    })
    return
  }

  const soundSrc = customSoundAssetMap[sound as CustomNotificationSound]
  if (!soundSrc) {
    playSystemBeep()
    return
  }

  // Stop any currently playing sound to prevent overlap
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }

  const audio = new Audio(soundSrc)
  currentAudio = audio

  audio.play().catch(() => {
    // File not found or autoplay blocked - fallback to system beep
    playSystemBeep()
  })
}

/**
 * Play a synthesized system beep as fallback when audio files are unavailable.
 * Uses Web Audio API to generate a short tone.
 */
function playSystemBeep(): void {
  try {
    // Reuse or create audio context
    if (!audioContext) {
      audioContext = new AudioContext()
    }

    // Resume context if it's suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }

    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()

    oscillator.connect(gain)
    gain.connect(audioContext.destination)

    // Configure a pleasant notification tone
    oscillator.frequency.value = 800
    oscillator.type = 'sine'
    gain.gain.value = 0.1

    // Play for 150ms
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.15)
  } catch {
    // Silently fail if Web Audio API is unavailable
  }
}

// Cache for preloaded audio elements
const audioCache = new Map<CustomNotificationSound, HTMLAudioElement>()

/**
 * Preload all bundled sound files to ensure instant playback.
 * Call this on app startup.
 *
 * System sounds are not preloaded — playback goes through the OS, which already
 * caches its own alert sounds, and there can be dozens of them.
 */
export function preloadAllSounds(): void {
  for (const option of customNotificationSoundOptions) {
    const soundSrc = customSoundAssetMap[option.value]
    if (!soundSrc) continue

    const audio = new Audio(soundSrc)
    audio.preload = 'auto'
    audioCache.set(option.value, audio)
  }
}
