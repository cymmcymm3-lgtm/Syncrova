import { Linking } from 'react-native';
import { WEB_APP_ORIGIN } from '../config';

const MAIN_APP_DEEP_LINK = 'syncrova://open/dashboard';

export const openMainSyncrova = async () => {
  try {
    await Linking.openURL(MAIN_APP_DEEP_LINK);
    return true;
  } catch {
    if (!WEB_APP_ORIGIN) return false;
    try {
      await Linking.openURL(`${WEB_APP_ORIGIN}/dashboard`);
      return true;
    } catch {
      return false;
    }
  }
};
