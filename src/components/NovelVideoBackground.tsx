import { useVideoPlayer, VideoView } from 'expo-video';
import { Platform, StyleSheet } from 'react-native';

type NovelVideoBackgroundProps = {
  uri: string;
};

export function NovelVideoBackground({ uri }: NovelVideoBackgroundProps) {
  const player = useVideoPlayer(uri, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
    nextPlayer.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="cover"
      nativeControls={false}
      surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
    />
  );
}

const styles = StyleSheet.create({
  video: {
    ...StyleSheet.absoluteFill,
  },
});
