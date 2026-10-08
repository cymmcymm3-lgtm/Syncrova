import AsyncStorage from '@react-native-async-storage/async-storage';

type CacheEnvelope<T> = {
  savedAt: number;
  value: T;
};

export const readJsonCache = async <T,>(key: string, maxAgeMs?: number): Promise<T | null> => {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (maxAgeMs && Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.value;
  } catch {
    return null;
  }
};

export const writeJsonCache = async <T,>(key: string, value: T) => {
  const payload: CacheEnvelope<T> = {
    savedAt: Date.now(),
    value
  };
  await AsyncStorage.setItem(key, JSON.stringify(payload));
};
