import { useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

/** Keeps the user's unfinished text visible while the parent normalizes its value. */
export function DraftTextInput({ value = '', onChangeText, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <TextInput
      {...props}
      value={focused ? draft : value}
      onFocus={(event) => {
        setDraft(value);
        setFocused(true);
        onFocus?.(event);
      }}
      onChangeText={(text) => {
        setDraft(text);
        onChangeText?.(text);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
