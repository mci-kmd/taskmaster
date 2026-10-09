import type { ComponentType } from 'react'

/** A page of the dev-only UI gallery: real components rendered with fixture data. */
export type GallerySection = {
  id: string
  title: string
  /** Sections are listed in ascending order. */
  order: number
  Component: ComponentType
}
