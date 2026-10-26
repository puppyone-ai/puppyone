import { createContext, useContext, type ReactNode } from "react";
import { OrderedDither, type OrderedDitherProps } from "./OrderedDither";

/**
 * The Appearance loading style. It draws every loading surface in one
 * material: loading placeholders here, and the loading mark (LoadingMark.tsx).
 * - `rounded`: flat rounded shapes in the skeleton tone that breathe in place.
 * - `dither`: the same shapes built on a pixel lattice and lit by an
 *   ordered-dither light (OrderedDither).
 */
export type LoadingPlaceholderStyle = "rounded" | "dither";

export const LOADING_PLACEHOLDER_STYLES: readonly LoadingPlaceholderStyle[] = Object.freeze(["rounded", "dither"]);
export const DEFAULT_LOADING_PLACEHOLDER_STYLE: LoadingPlaceholderStyle = "rounded";

export function parseLoadingPlaceholderStyle(value: unknown): LoadingPlaceholderStyle {
  return value === "rounded" || value === "dither" ? value : DEFAULT_LOADING_PLACEHOLDER_STYLE;
}

const LoadingPlaceholderStyleContext = createContext<LoadingPlaceholderStyle>(DEFAULT_LOADING_PLACEHOLDER_STYLE);

export function LoadingPlaceholderStyleProvider({
  style,
  children,
}: {
  style: LoadingPlaceholderStyle;
  children: ReactNode;
}) {
  return <LoadingPlaceholderStyleContext.Provider value={style}>{children}</LoadingPlaceholderStyleContext.Provider>;
}

export function useLoadingPlaceholderStyle(): LoadingPlaceholderStyle {
  return useContext(LoadingPlaceholderStyleContext);
}

export type PlaceholderLayerProps = OrderedDitherProps;

/**
 * The style-specific layer of a loading placeholder surface. Render it as the
 * last child of an element with the `po-placeholder-surface` class whose
 * shapes carry `data-placeholder-shape` (or which is itself the shape). The
 * rounded style needs no layer: its shapes paint and breathe in CSS.
 */
export function PlaceholderLayer(props: PlaceholderLayerProps) {
  return useLoadingPlaceholderStyle() === "dither" ? <OrderedDither {...props} /> : null;
}
