import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Bottom padding needed to keep composers above the software keyboard on Android.
 * iOS returns 0 — prefer KeyboardAvoidingView there.
 * Pair with SafeAreaView edges that omit `bottom` while this value is > 0.
 */
export function useKeyboardBottomInset() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      return;
    }

    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (Platform.OS === 'ios' || keyboardHeight <= 0) {
    return 0;
  }

  return keyboardHeight;
}
