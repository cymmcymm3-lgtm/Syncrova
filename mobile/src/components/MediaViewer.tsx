import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ListRenderItemInfo, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { Play } from 'lucide-react-native';
import type { MediaViewerItem } from '../utils/mediaHelpers';
import MediaViewerFooter from './MediaViewerFooter';
import MediaViewerHeader from './MediaViewerHeader';

type MediaViewerProps = {
  visible: boolean;
  items: MediaViewerItem[];
  initialIndex?: number;
  onClose: () => void;
  onReply?: () => void;
};

type ViewerItemProps = {
  item: MediaViewerItem;
  width: number;
  height: number;
  onClose: () => void;
  onToggleChrome: () => void;
};

const getFrameSize = (item: MediaViewerItem, width: number, height: number) => {
  const maxWidth = Math.max(1, width - 24);
  const maxHeight = Math.max(1, height * 0.72);
  const sourceRatio = item.width && item.height ? item.width / item.height : item.type === 'video' ? 9 / 16 : 1;
  const boundedByWidthHeight = maxWidth / sourceRatio;

  if (boundedByWidthHeight <= maxHeight) {
    return {
      frameHeight: boundedByWidthHeight,
      frameWidth: maxWidth
    };
  }

  return {
    frameHeight: maxHeight,
    frameWidth: maxHeight * sourceRatio
  };
};

function VideoSlide({
  item,
  width,
  height,
  onClose,
  onToggleChrome
}: {
  item: MediaViewerItem;
  width: number;
  height: number;
  onClose: () => void;
  onToggleChrome: () => void;
}) {
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const player = useVideoPlayer({ uri: item.url, useCaching: true }, nextPlayer => {
    nextPlayer.loop = false;
    nextPlayer.bufferOptions = {
      minBufferForPlayback: 0.25,
      preferredForwardBufferDuration: 6,
      waitsToMinimizeStalling: false
    };
  });

  useEffect(() => {
    let mounted = true;
    const startTimer = setTimeout(() => {
      try {
        player.play();
      } catch {
        if (mounted) setFailed(true);
      }
    }, 80);
    const statusSubscription = player.addListener('statusChange', event => {
      if (!mounted) return;
      setFailed(event.status === 'error');
      setLoading(event.status === 'loading' || event.status === 'idle');
    });

    return () => {
      mounted = false;
      clearTimeout(startTimer);
      statusSubscription.remove();
      player.pause();
    };
  }, [item.url, player]);

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onUpdate(event => {
      translateY.value = event.translationY;
      scale.value = Math.max(0.88, 1 - Math.abs(event.translationY) / height);
    })
    .onEnd(event => {
      if (Math.abs(event.translationY) > height * 0.26) {
        runOnJS(onClose)();
        return;
      }
      translateY.value = withSpring(0, { damping: 35, stiffness: 420 });
      scale.value = withSpring(1, { damping: 35, stiffness: 420 });
    });
  const tap = Gesture.Tap().maxDuration(220).onEnd(() => {
    runOnJS(onToggleChrome)();
  });
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }]
  }));
  const { frameHeight, frameWidth } = getFrameSize(item, width, height);

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, tap)}>
      <Animated.View className="items-center justify-center" style={[{ height, width }, animatedStyle]}>
        <View
          className="overflow-hidden bg-black"
          style={{
            borderRadius: 20,
            elevation: 8,
            height: frameHeight,
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 0.24,
            shadowRadius: 28,
            width: frameWidth
          }}
        >
          {item.thumbnailUrl && !firstFrameReady ? (
            <ExpoImage
              blurRadius={2}
              cachePolicy="memory-disk"
              contentFit="cover"
              source={{ uri: item.thumbnailUrl }}
              style={{ height: frameHeight, position: 'absolute', width: frameWidth }}
            />
          ) : null}
          <VideoView
            contentFit="contain"
            nativeControls
            onFirstFrameRender={() => {
              setFirstFrameReady(true);
              setLoading(false);
            }}
            player={player}
            surfaceType="surfaceView"
            style={{ height: frameHeight, width: frameWidth }}
            useExoShutter={false}
          />
          {loading && !firstFrameReady ? (
            <View className="absolute inset-0 items-center justify-center bg-black/20">
              <View className="items-center justify-center rounded-full bg-black/45 p-4">
                <ActivityIndicator color="#FFFFFF" />
              </View>
            </View>
          ) : null}
          {failed ? (
            <Pressable
              className="absolute inset-0 items-center justify-center bg-black/55"
              onPress={() => {
                setFailed(false);
                setLoading(true);
                player.replay();
                player.play();
              }}
            >
              <Play color="#FFFFFF" fill="#FFFFFF" size={24} />
              <Text className="mt-2 text-xs font-bold text-white">Tap to retry</Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

function ViewerItem({ item, width, height, onClose, onToggleChrome }: ViewerItemProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    scale.value = withSpring(1, { damping: 40, stiffness: 500 });
    translateX.value = withSpring(0, { damping: 40, stiffness: 500 });
    translateY.value = withSpring(0, { damping: 40, stiffness: 500 });
    savedScale.value = 1;
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.max(1, Math.min(5, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1.02) reset();
    });

  const pan = Gesture.Pan()
    .onUpdate(event => {
      if (scale.value > 1.01) {
        translateX.value = savedX.value + event.translationX;
        translateY.value = savedY.value + event.translationY;
      } else {
        translateY.value = event.translationY;
        scale.value = Math.max(0.86, 1 - Math.abs(event.translationY) / height);
      }
    })
    .onEnd(event => {
      if (scale.value <= 1.01 && event.translationY > height * 0.3) {
        runOnJS(onClose)();
        return;
      }
      savedX.value = translateX.value;
      savedY.value = translateY.value;
      if (scale.value <= 1.01) reset();
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomed = scale.value > 1.01;
      scale.value = withSpring(zoomed ? 1 : 2, { damping: 35, stiffness: 450 });
      translateX.value = withSpring(0, { damping: 35, stiffness: 450 });
      translateY.value = withSpring(0, { damping: 35, stiffness: 450 });
      savedScale.value = zoomed ? 1 : 2;
      savedX.value = 0;
      savedY.value = 0;
    });

  const singleTap = Gesture.Tap()
    .maxDuration(220)
    .onEnd(() => {
      runOnJS(onToggleChrome)();
    });

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ]
  }));
  const { frameHeight, frameWidth } = getFrameSize(item, width, height);

  useEffect(() => () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
  }, []);

  if (item.type === 'video') {
    return <VideoSlide height={height} item={item} onClose={onClose} onToggleChrome={onToggleChrome} width={width} />;
  }

  return (
    <GestureDetector gesture={gesture}>
      <View className="items-center justify-center" style={{ height, width }}>
        <Animated.View
          className="overflow-hidden bg-black/15"
          style={[
            {
              borderRadius: 20,
              elevation: 8,
              height: frameHeight,
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 18 },
              shadowOpacity: 0.22,
              shadowRadius: 28,
              width: frameWidth
            },
            imageStyle
          ]}
        >
          {item.thumbnailUrl ? (
            <ExpoImage
              blurRadius={8}
              cachePolicy="memory-disk"
              contentFit="cover"
              source={{ uri: item.thumbnailUrl }}
              style={{ height: frameHeight, position: 'absolute', width: frameWidth }}
            />
          ) : null}
          <ExpoImage
            cachePolicy="memory-disk"
            contentFit="contain"
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
            onLoadEnd={() => {
              if (loadingTimer.current) clearTimeout(loadingTimer.current);
              setLoading(false);
            }}
            onLoadStart={() => {
              setFailed(false);
              loadingTimer.current = setTimeout(() => setLoading(true), 1000);
            }}
            source={{ uri: item.url }}
            style={{ height: frameHeight, width: frameWidth }}
            transition={160}
          />
          {loading ? <ActivityIndicator className="absolute self-center" color="#FFFFFF" style={{ top: frameHeight / 2 - 10 }} /> : null}
          {failed ? (
            <View className="absolute inset-0 items-center justify-center bg-black/55 px-4">
              <Text className="font-semibold text-white">Could not load media</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export default function MediaViewer({ visible, items, initialIndex = 0, onClose, onReply }: MediaViewerProps) {
  const dimensions = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(true);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(80);
  const listRef = useRef<FlatList<MediaViewerItem>>(null);
  const currentItem = items[index];

  useEffect(() => {
    if (!visible) return;
    setIndex(initialIndex);
    setChromeVisible(true);
    opacity.value = withTiming(1, { duration: 200 });
    translateY.value = withSpring(0, { damping: 40, stiffness: 500 });
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ animated: false, index: initialIndex });
    });
  }, [initialIndex, opacity, translateY, visible]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }]
  }));

  const renderItem = ({ item }: ListRenderItemInfo<MediaViewerItem>) => (
    <ViewerItem
      height={dimensions.height}
      item={item}
      onClose={onClose}
      onToggleChrome={() => setChromeVisible(value => !value)}
      width={dimensions.width}
    />
  );

  const keyExtractor = useMemo(() => (item: MediaViewerItem) => item.id, []);

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={visible}>
      <Animated.View className="flex-1" style={[{ backgroundColor: '#68708E' }, containerStyle]}>
        <FlatList
          data={items}
          getItemLayout={(_, itemIndex) => ({
            index: itemIndex,
            length: dimensions.width,
            offset: dimensions.width * itemIndex
          })}
          horizontal
          initialScrollIndex={initialIndex}
          keyExtractor={keyExtractor}
          onMomentumScrollEnd={event => {
            setIndex(Math.round(event.nativeEvent.contentOffset.x / dimensions.width));
          }}
          pagingEnabled
          ref={listRef}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          windowSize={3}
        />
        <MediaViewerHeader item={currentItem} onClose={onClose} visible={chromeVisible} />
        <MediaViewerFooter
          index={index}
          item={currentItem}
          onReply={onReply}
          total={items.length}
          visible={chromeVisible}
        />
      </Animated.View>
    </Modal>
  );
}
