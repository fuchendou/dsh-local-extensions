import type { ComposerAttachment, ConversationController, InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { OfficeFeatureId } from '../features'

/** Matches the installed document-preview package's additive toolbar contract. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.right.tab.document.actions': {
      kind: 'list'
      scope: 'session'
      owner: { readonly absolutePath: string }
    }
  }
  interface LocaleNamespaceMap {
    'dsh-office-kit': string
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    readonly office: { readonly feature: OfficeFeatureId }
    readonly officeAnnotation: { readonly items: readonly OfficeAnnotation[] }
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    officeCatalog: unknown
  }
}

export interface OfficeChipInjected {
  openOffice: (feature: OfficeFeatureId) => void
  officeLabel: (feature: OfficeFeatureId) => string
}

export interface AnnotationRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface AnnotationTextRun {
  readonly text: string
  readonly box: AnnotationRect
}

export interface AnnotationParagraph extends AnnotationTextRun {
  /** Actual text occupancy, distinct from the paragraph's outline/crop envelope. */
  readonly rects?: readonly AnnotationRect[]
}

/** Durable, model-readable annotation; images remain normal conversation attachments. */
export interface OfficeAnnotation {
  readonly target: string
  readonly fileName: string
  readonly page?: number
  /** Worksheet that was on screen for an xlsx region, when the preview names it. */
  readonly sheet?: string
  /** A1 range the preview itself reported for the region; never inferred from pixels. */
  readonly range?: string
  /** The preview exposed no sheet/range for the region, so only `region` locates it. */
  readonly unmapped?: true
  readonly text: string
  readonly requirement: string
  readonly region?: AnnotationRect
  readonly imageName?: string
}

export interface PendingAnnotation {
  readonly annotation: OfficeAnnotation
  readonly file?: File
}

export interface AnnotationSelection extends AnnotationParagraph {
  readonly canvas?: HTMLCanvasElement
  readonly page?: number
  readonly region?: AnnotationRect
}

export interface AnnotationImageLimits {
  readonly maxImagesPerMessage: number
  readonly maxImageBytes: number
  readonly maxMessageImageBytes: number
  readonly maxImagePixels: number
  readonly maxImageDimension: number
  readonly mediaTypes: readonly string[]
}

/** Compatibility seam: these concrete controller methods are not on outward IConversation. */
export type AnnotationController = Pick<ConversationController, 'createDrafts' | 'releaseDraftAttachments' | 'resolveDraftAttachments'>

export interface AnnotationIntake {
  readonly create: (files: readonly File[]) => readonly ComposerAttachment[]
  readonly release: (drafts: readonly ComposerAttachment[]) => void
  readonly images: (ids: readonly ComposerAttachment['id'][]) => readonly { readonly size: number }[]
}

export interface AnnotationInjected {
  readonly pendingAnnotations: Map<string, readonly PendingAnnotation[]>
  readonly intake?: AnnotationIntake
  readonly openAnnotation: (target: string) => void
}

export interface AnnotationSendInput {
  readonly items: readonly PendingAnnotation[]
  readonly inputActions: InputActions
  readonly intake?: AnnotationIntake
  readonly limits?: AnnotationImageLimits
  readonly existingImages: readonly { readonly size: number }[]
  readonly deferSubmit?: boolean
}

/** Existing text-quote helper contract, shared by its focused tests. */
export interface QuotePrompt {
  readonly target: string
  readonly pageLabel?: string
  readonly heading: string
  readonly originalLabel: string
  readonly requirementLabel: string
  readonly text: string
  readonly requirement: string
}
