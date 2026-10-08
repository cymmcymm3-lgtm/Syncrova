import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Check, Crop, Palette, RotateCw, Send, Smile, Type, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  GestureResponderEvent,
  Modal,
  PanResponder,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import ViewShot, { captureRef } from 'react-native-view-shot';
import { useTheme } from '../theme/ThemeContext';

type EditorTool = 'crop' | 'rotate' | 'text' | 'draw' | 'stickers' | 'filters';
type AspectPreset = 'original' | 'free' | '1:1' | '4:5' | '16:9';
type FilterPreset = 'original' | 'warm' | 'cool' | 'vintage' | 'bw';

type OverlayItem = {
  id: string;
  kind: 'text' | 'emoji';
  value: string;
  color: string;
  size: number;
  x: number;
  y: number;
};

type DrawStroke = {
  id: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
};

type MediaEditorModalProps = {
  asset: ImagePickerAsset | null;
  visible: boolean;
  sending?: boolean;
  onCancel: () => void;
  onSend: (asset: ImagePickerAsset) => Promise<void> | void;
};

const aspectRatios: Array<{ id: AspectPreset; label: string; ratio?: number }> = [
  { id: 'original', label: 'Original' },
  { id: 'free', label: 'Free' },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 }
];

const filters: Array<{ id: FilterPreset; label: string; overlay?: string; opacity?: number; grayscale?: boolean }> = [
  { id: 'original', label: 'Original' },
  { id: 'warm', label: 'Warm', overlay: '#F97316', opacity: 0.12 },
  { id: 'cool', label: 'Cool', overlay: '#2563EB', opacity: 0.13 },
  { id: 'vintage', label: 'Vintage', overlay: '#A16207', opacity: 0.18 },
  { id: 'bw', label: 'B&W', overlay: '#111827', opacity: 0.28, grayscale: true }
];

const colors = ['#FFFFFF', '#0F172A', '#2563EB', '#10B981', '#F97316', '#E11D48', '#FACC15'];
const emojis = ['❤️', '🔥', '😂', '😍', '✨', '✅', '😭', '👍'];

const pointToPath = (points: DrawStroke['points']) => {
  if (!points.length) return '';
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ${rest.map(point => `L ${point.x} ${point.y}`).join(' ')}`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function ToolButton({
  active,
  label,
  onPress,
  children
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <Pressable className="items-center gap-1" onPress={onPress}>
      <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: active ? colors.primary : colors.surfaceHover }}>
        {children}
      </View>
      <Text className="text-[10px] font-semibold text-white/80">{label}</Text>
    </Pressable>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const { colors } = useTheme();

  return (
    <View className="flex-row items-center gap-3">
      <Text className="w-20 text-xs font-semibold text-white/70">{label}</Text>
      <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-white/10" onPress={() => onChange(clamp(value - step, min, max))}>
        <Text className="text-lg font-bold text-white">-</Text>
      </Pressable>
      <View className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
        <View className="h-full rounded-full" style={{ backgroundColor: colors.primary, width: `${((value - min) / (max - min)) * 100}%` }} />
      </View>
      <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-white/10" onPress={() => onChange(clamp(value + step, min, max))}>
        <Text className="text-lg font-bold text-white">+</Text>
      </Pressable>
    </View>
  );
}

function DraggableOverlay({
  item,
  selected,
  previewWidth,
  previewHeight,
  onMove,
  onSelect
}: {
  item: OverlayItem;
  selected: boolean;
  previewWidth: number;
  previewHeight: number;
  onMove: (id: string, x: number, y: number) => void;
  onSelect: (id: string) => void;
}) {
  const start = useRef({ x: item.x, y: item.y });
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      start.current = { x: item.x, y: item.y };
      onSelect(item.id);
    },
    onPanResponderMove: (_, gesture) => {
      onMove(
        item.id,
        clamp(start.current.x + gesture.dx, 0, Math.max(0, previewWidth - 40)),
        clamp(start.current.y + gesture.dy, 0, Math.max(0, previewHeight - 40))
      );
    }
  }), [item.id, item.x, item.y, onMove, onSelect, previewHeight, previewWidth]);

  return (
    <View
      {...panResponder.panHandlers}
      className={selected ? 'rounded-xl border border-white/80 px-1' : 'px-1'}
      style={{ left: item.x, position: 'absolute', top: item.y }}
    >
      <Text style={{ color: item.color, fontSize: item.size, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 3 }}>
        {item.value}
      </Text>
    </View>
  );
}

function VideoPreview({ uri, height, width }: { uri: string; height: number; width: number }) {
  const player = useVideoPlayer(uri, nextPlayer => {
    nextPlayer.loop = true;
  });

  useEffect(() => {
    player.play();
    return () => {
      player.pause();
    };
  }, [player]);

  return (
    <VideoView
      contentFit="contain"
      nativeControls
      player={player}
      style={{ height, width }}
    />
  );
}

export default function MediaEditorModal({ asset, visible, sending = false, onCancel, onSend }: MediaEditorModalProps) {
  const { colors: themeColors } = useTheme();
  const dimensions = useWindowDimensions();
  const viewShotRef = useRef<ViewShot>(null);
  const [tool, setTool] = useState<EditorTool>('crop');
  const [aspect, setAspect] = useState<AspectPreset>('original');
  const [rotation, setRotation] = useState(0);
  const [filter, setFilter] = useState<FilterPreset>('original');
  const [textDraft, setTextDraft] = useState('');
  const [activeColor, setActiveColor] = useState('#FFFFFF');
  const [textSize, setTextSize] = useState(30);
  const [brushSize, setBrushSize] = useState(5);
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [previewSize, setPreviewSize] = useState({ height: 1, width: 1 });
  const [rendering, setRendering] = useState(false);
  const currentStrokeId = useRef<string | null>(null);

  const isVideo = asset?.type === 'video' || String(asset?.mimeType || '').startsWith('video/');
  const isImage = Boolean(asset) && !isVideo;
  const selectedFilter = filters.find(item => item.id === filter) || filters[0];
  const assetRatio = asset?.width && asset?.height ? asset.width / asset.height : 1;
  const selectedRatio = aspectRatios.find(item => item.id === aspect)?.ratio || (aspect === 'original' ? assetRatio : undefined);
  const previewWidth = Math.min(dimensions.width - 28, 430);
  const fallbackHeight = Math.min(dimensions.height * 0.58, 560);
  const previewHeight = selectedRatio ? Math.min(fallbackHeight, previewWidth / selectedRatio) : fallbackHeight;

  useEffect(() => {
    if (!visible) return;
    setTool('crop');
    setAspect('original');
    setRotation(0);
    setFilter('original');
    setTextDraft('');
    setActiveColor('#FFFFFF');
    setTextSize(30);
    setBrushSize(5);
    setOverlays([]);
    setSelectedOverlayId(null);
    setStrokes([]);
    currentStrokeId.current = null;
  }, [asset?.uri, visible]);

  const updateOverlayPosition = useCallback((id: string, x: number, y: number) => {
    setOverlays(previous => previous.map(item => (item.id === id ? { ...item, x, y } : item)));
  }, []);

  const addTextOverlay = () => {
    const value = textDraft.trim();
    if (!value) return;
    const id = `text-${Date.now()}`;
    setOverlays(previous => [...previous, {
      id,
      kind: 'text',
      value,
      color: activeColor,
      size: textSize,
      x: previewSize.width * 0.22,
      y: previewSize.height * 0.42
    }]);
    setSelectedOverlayId(id);
    setTextDraft('');
  };

  const addEmojiOverlay = (emoji: string) => {
    const id = `emoji-${Date.now()}`;
    setOverlays(previous => [...previous, {
      id,
      kind: 'emoji',
      value: emoji,
      color: '#FFFFFF',
      size: textSize + 8,
      x: previewSize.width * 0.42,
      y: previewSize.height * 0.42
    }]);
    setSelectedOverlayId(id);
  };

  const updateSelectedSize = (size: number) => {
    setTextSize(size);
    if (!selectedOverlayId) return;
    setOverlays(previous => previous.map(item => (item.id === selectedOverlayId ? { ...item, size } : item)));
  };

  const getPoint = (event: GestureResponderEvent) => ({
    x: event.nativeEvent.locationX,
    y: event.nativeEvent.locationY
  });

  const startStroke = (event: GestureResponderEvent) => {
    if (tool !== 'draw' || !isImage) return;
    const id = `stroke-${Date.now()}`;
    currentStrokeId.current = id;
    setStrokes(previous => [...previous, { id, color: activeColor, size: brushSize, points: [getPoint(event)] }]);
  };

  const moveStroke = (event: GestureResponderEvent) => {
    const id = currentStrokeId.current;
    if (!id || tool !== 'draw' || !isImage) return;
    const point = getPoint(event);
    setStrokes(previous => previous.map(stroke => (
      stroke.id === id ? { ...stroke, points: [...stroke.points, point] } : stroke
    )));
  };

  const finishStroke = () => {
    currentStrokeId.current = null;
  };

  const sendEditedAsset = async () => {
    if (!asset || sending || rendering) return;

    if (isVideo) {
      await onSend(asset);
      return;
    }

    try {
      setRendering(true);
      const ratio = previewSize.width / Math.max(1, previewSize.height);
      const exportWidth = ratio >= 1 ? 1600 : Math.round(1600 * ratio);
      const exportHeight = ratio >= 1 ? Math.round(1600 / ratio) : 1600;
      const capturedUri = await captureRef(viewShotRef, {
        format: 'jpg',
        height: exportHeight,
        quality: 0.92,
        result: 'tmpfile',
        width: exportWidth
      });
      const compressed = await manipulateAsync(capturedUri, [], {
        compress: 0.8,
        format: SaveFormat.JPEG
      });
      await onSend({
        ...asset,
        fileName: `syncrova-edited-${Date.now()}.jpg`,
        height: compressed.height,
        mimeType: 'image/jpeg',
        type: 'image',
        uri: compressed.uri,
        width: compressed.width
      });
    } catch (error) {
      Alert.alert('Editor failed', 'Could not render the edited media.');
    } finally {
      setRendering(false);
    }
  };

  if (!asset) return null;

  return (
    <Modal animationType="slide" onRequestClose={onCancel} visible={visible}>
      <View className="flex-1 pt-12" style={{ backgroundColor: themeColors.background }}>
        <View className="h-14 flex-row items-center justify-between px-4">
          <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-white/10" disabled={rendering} onPress={onCancel}>
            <X color="#FFFFFF" size={22} />
          </Pressable>
          <Text className="text-base font-semibold text-white" numberOfLines={1}>
            {isVideo ? 'Preview video' : 'Edit media'}
          </Text>
          <Pressable
            className="h-10 flex-row items-center gap-2 rounded-full px-4"
            disabled={sending || rendering}
            onPress={sendEditedAsset}
            style={{ backgroundColor: themeColors.primary }}
          >
            {sending || rendering ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Send color="#FFFFFF" size={16} />}
            <Text className="text-sm font-semibold text-white">Send</Text>
          </Pressable>
        </View>

        <View className="flex-1 items-center justify-center px-3">
          <ViewShot
            options={{ format: 'jpg', quality: 0.92, result: 'tmpfile' }}
            ref={viewShotRef}
            style={{ backgroundColor: '#000000', borderRadius: 18, height: previewHeight, overflow: 'hidden', width: previewWidth }}
          >
            <View
              className="flex-1 overflow-hidden"
              onLayout={event => setPreviewSize({
                height: event.nativeEvent.layout.height,
                width: event.nativeEvent.layout.width
              })}
              onResponderEnd={finishStroke}
              onResponderGrant={startStroke}
              onResponderMove={moveStroke}
              onResponderRelease={finishStroke}
              onStartShouldSetResponder={() => tool === 'draw' && isImage}
            >
              {isVideo ? (
                <VideoPreview height={previewHeight} uri={asset.uri} width={previewWidth} />
              ) : (
                <ExpoImage
                  cachePolicy="memory-disk"
                  contentFit={aspect === 'original' ? 'contain' : 'cover'}
                  source={{ uri: asset.uri }}
                  style={{
                    height: previewHeight,
                    transform: [{ rotate: `${rotation}deg` }, { scale: selectedFilter.grayscale ? 1.02 : 1 }],
                    width: previewWidth
                  }}
                />
              )}
              {selectedFilter.overlay ? (
                <View pointerEvents="none" style={{ backgroundColor: selectedFilter.overlay, bottom: 0, left: 0, opacity: selectedFilter.opacity, position: 'absolute', right: 0, top: 0 }} />
              ) : null}
              {selectedFilter.grayscale ? (
                <View pointerEvents="none" style={{ backgroundColor: '#000000', bottom: 0, left: 0, opacity: 0.25, position: 'absolute', right: 0, top: 0 }} />
              ) : null}
              <Svg height={previewSize.height} pointerEvents="none" style={{ left: 0, position: 'absolute', top: 0 }} width={previewSize.width}>
                {strokes.map(stroke => (
                  <Path
                    d={pointToPath(stroke.points)}
                    fill="none"
                    key={stroke.id}
                    stroke={stroke.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={stroke.size}
                  />
                ))}
              </Svg>
              {overlays.map(item => (
                <DraggableOverlay
                  item={item}
                  key={item.id}
                  onMove={updateOverlayPosition}
                  onSelect={setSelectedOverlayId}
                  previewHeight={previewSize.height}
                  previewWidth={previewSize.width}
                  selected={selectedOverlayId === item.id}
                />
              ))}
            </View>
          </ViewShot>
        </View>

        <View className="border-t border-white/10 px-3 pb-5 pt-3">
          {tool === 'crop' ? (
            <View className="mb-4 flex-row flex-wrap gap-2">
              {aspectRatios.map(item => (
                <Pressable
                  className="rounded-full px-3 py-2"
                  key={item.id}
                  onPress={() => setAspect(item.id)}
                  style={{ backgroundColor: aspect === item.id ? themeColors.primary : themeColors.surfaceHover }}
                >
                  <Text className="text-xs font-semibold text-white">{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {tool === 'rotate' ? (
            <View className="mb-4 flex-row items-center justify-center gap-3">
              <Pressable className="h-11 flex-row items-center gap-2 rounded-full bg-white/10 px-4" onPress={() => setRotation(value => (value + 90) % 360)}>
                <RotateCw color="#FFFFFF" size={18} />
                <Text className="text-sm font-semibold text-white">Rotate 90°</Text>
              </Pressable>
            </View>
          ) : null}

          {tool === 'text' ? (
            <View className="mb-4 gap-3">
              <View className="h-11 flex-row items-center gap-2 rounded-2xl bg-white/10 px-3">
                <TextInput
                  className="flex-1 text-[15px] text-white"
                  onChangeText={setTextDraft}
                  placeholder="Add text"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  value={textDraft}
                />
                <Pressable className="h-8 w-8 items-center justify-center rounded-full" onPress={addTextOverlay} style={{ backgroundColor: themeColors.primary }}>
                  <Check color="#FFFFFF" size={16} />
                </Pressable>
              </View>
              <Stepper label="Text size" max={58} min={18} onChange={updateSelectedSize} step={4} value={textSize} />
            </View>
          ) : null}

          {tool === 'draw' ? (
            <View className="mb-4 gap-3">
              <Stepper label="Brush" max={18} min={2} onChange={setBrushSize} step={1} value={brushSize} />
              <Pressable className="self-start rounded-full bg-white/10 px-3 py-2" onPress={() => setStrokes([])}>
                <Text className="text-xs font-semibold text-white">Clear drawing</Text>
              </Pressable>
            </View>
          ) : null}

          {tool === 'stickers' ? (
            <View className="mb-4 gap-3">
              <View className="flex-row flex-wrap gap-2">
                {emojis.map(emoji => (
                  <Pressable className="h-10 w-10 items-center justify-center rounded-full bg-white/10" key={emoji} onPress={() => addEmojiOverlay(emoji)}>
                    <Text className="text-xl">{emoji}</Text>
                  </Pressable>
                ))}
              </View>
              <Stepper label="Sticker" max={70} min={24} onChange={updateSelectedSize} step={4} value={textSize} />
            </View>
          ) : null}

          {tool === 'filters' ? (
            <View className="mb-4 flex-row flex-wrap gap-2">
              {filters.map(item => (
                <Pressable
                  className="rounded-full px-3 py-2"
                  key={item.id}
                  onPress={() => setFilter(item.id)}
                  style={{ backgroundColor: filter === item.id ? themeColors.primary : themeColors.surfaceHover }}
                >
                  <Text className="text-xs font-semibold text-white">{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {(tool === 'text' || tool === 'draw') ? (
            <View className="mb-4 flex-row gap-2">
              {colors.map(color => (
                <Pressable
                  className="h-8 w-8 rounded-full border"
                  key={color}
                  onPress={() => setActiveColor(color)}
                  style={{ backgroundColor: color, borderColor: activeColor === color ? themeColors.primary : 'rgba(255,255,255,0.45)', borderWidth: activeColor === color ? 3 : 1 }}
                />
              ))}
            </View>
          ) : null}

          <View className="flex-row justify-between">
            <ToolButton active={tool === 'crop'} label="Crop" onPress={() => setTool('crop')}>
              <Crop color="#FFFFFF" size={20} />
            </ToolButton>
            <ToolButton active={tool === 'rotate'} label="Rotate" onPress={() => setTool('rotate')}>
              <RotateCw color="#FFFFFF" size={20} />
            </ToolButton>
            <ToolButton active={tool === 'text'} label="Text" onPress={() => setTool('text')}>
              <Type color="#FFFFFF" size={20} />
            </ToolButton>
            <ToolButton active={tool === 'draw'} label="Draw" onPress={() => setTool('draw')}>
              <Palette color="#FFFFFF" size={20} />
            </ToolButton>
            <ToolButton active={tool === 'stickers'} label="Emoji" onPress={() => setTool('stickers')}>
              <Smile color="#FFFFFF" size={20} />
            </ToolButton>
            <ToolButton active={tool === 'filters'} label="Filters" onPress={() => setTool('filters')}>
              <Palette color="#FFFFFF" size={20} />
            </ToolButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}
