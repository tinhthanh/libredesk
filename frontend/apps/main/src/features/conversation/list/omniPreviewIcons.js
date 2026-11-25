// Icon per kind of omni-core previewParts, for the conversation list (the same
// icons the Vetgo app uses).
import {
  ChartBar,
  Info,
  MessageCircleHeart,
  Pencil,
  Undo2,
  Users,
  Contact,
  Image,
  Link,
  MapPin,
  Mic,
  Paperclip,
  Phone,
  Reply,
  Smartphone,
  SquareCheck,
  Sticker,
  TriangleAlert,
  UserPlus,
  Video
} from 'lucide-vue-next'

export const OMNI_PREVIEW_ICONS = {
  owner: Smartphone,
  quote: Reply,
  sticker: Sticker,
  image: Image,
  file: Paperclip,
  video: Video,
  audio: Mic,
  call: Phone,
  link: Link,
  contact: Contact,
  poll: ChartBar,
  location: MapPin,
  todo: SquareCheck,
  friend: UserPlus,
  alert: TriangleAlert,
  system: Info,
  recall: Undo2,
  edit: Pencil,
  reaction: MessageCircleHeart,
  group: Users
}
