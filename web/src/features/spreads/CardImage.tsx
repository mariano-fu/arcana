import { cardImageUrl, type CardImageSize } from '../../seed/images/card-images';

interface Props {
  cardKey: string;
  size: CardImageSize;
  reversed: boolean;
  /** Empty when a nearby text already names the card. */
  alt: string;
  className?: string;
}

/** A card's image; reversed cards are the same file turned 180°. */
export default function CardImage({ cardKey, size, reversed, alt, className = '' }: Props) {
  return (
    <img
      src={cardImageUrl(cardKey, size)}
      alt={alt}
      // Keeps the frame's shape while the file loads (images are 160×277 / 600×1043).
      width={size === 'thumb' ? 160 : 600}
      height={size === 'thumb' ? 277 : 1043}
      draggable={false}
      data-reversed={reversed}
      className={`h-auto rounded-sm bg-stone-200 transition-transform ${
        reversed ? 'rotate-180' : ''
      } ${className}`}
    />
  );
}
