type MediaFilter = {
  id: 'original' | 'vivid' | 'warm' | 'mono' | 'cool';
  label: string;
  css: string;
  canvas: string;
};

type MediaEdit = {
  filter?: string;
  rotate?: number;
  flipX?: boolean;
};
export const MEDIA_FILTERS: MediaFilter[] = [
  { id: 'original', label: 'Original', css: 'none', canvas: 'none' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.28) contrast(1.08)', canvas: 'saturate(1.28) contrast(1.08)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.18) saturate(1.16) brightness(1.03)', canvas: 'sepia(0.18) saturate(1.16) brightness(1.03)' },
  { id: 'mono', label: 'Mono', css: 'grayscale(1) contrast(1.08)', canvas: 'grayscale(1) contrast(1.08)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.08) hue-rotate(8deg) brightness(1.02)', canvas: 'saturate(1.08) hue-rotate(8deg) brightness(1.02)' }
];

const getFilter = (filterId?: string): MediaFilter =>
  MEDIA_FILTERS.find((filter) => filter.id === filterId) || MEDIA_FILTERS[0];

export const getDefaultMediaEdit = (): Required<MediaEdit> => ({
  filter: 'original',
  rotate: 0,
  flipX: false
});

export const normalizeMediaEdit = (edit: MediaEdit = {}): Required<MediaEdit> => ({
  filter: getFilter(edit.filter).id,
  rotate: (((Number(edit.rotate) || 0) % 360) + 360) % 360,
  flipX: Boolean(edit.flipX)
});

export const hasMediaEdits = (edit: MediaEdit = {}): boolean => {
  const normalized = normalizeMediaEdit(edit);
  return normalized.filter !== 'original' || normalized.rotate !== 0 || normalized.flipX;
};

export const getMediaEditPreviewStyle = (edit: MediaEdit = {}): { filter: string; transform: string } => {
  const normalized = normalizeMediaEdit(edit);
  return {
    filter: getFilter(normalized.filter).css,
    transform: `rotate(${normalized.rotate}deg) scaleX(${normalized.flipX ? -1 : 1})`
  };
};

const loadImageFromFile = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Could not load image for editing'));
  };
  image.src = url;
});

export const applyImageEdits = async (file: File, edit: MediaEdit = {}): Promise<File> => {
  const normalized = normalizeMediaEdit(edit);
  if (!file?.type?.startsWith('image/') || !hasMediaEdits(normalized)) return file;

  try {
    const image = await loadImageFromFile(file);
    const quarterTurn = normalized.rotate === 90 || normalized.rotate === 270;
    const canvas = document.createElement('canvas');
    canvas.width = quarterTurn ? image.naturalHeight || image.height : image.naturalWidth || image.width;
    canvas.height = quarterTurn ? image.naturalWidth || image.width : image.naturalHeight || image.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((normalized.rotate * Math.PI) / 180);
    ctx.scale(normalized.flipX ? -1 : 1, 1);
    ctx.filter = getFilter(normalized.filter).canvas;
    ctx.drawImage(image, -(image.naturalWidth || image.width) / 2, -(image.naturalHeight || image.height) / 2);
    ctx.restore();

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    const editedName = file.name?.replace(/\.[^.]+$/, `-edited.${extension}`) || `media-edited.${extension}`;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, 0.92));
    if (!blob) return file;

    return new File([blob], editedName, {
      type: outputType,
      lastModified: Date.now()
    });
  } catch {
    return file;
  }
};
