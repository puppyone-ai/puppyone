import {
  AudioResourceViewer,
  ImageResourceViewer,
  VideoResourceViewer,
} from "./ResourceViewers";
import { definePresetViewer } from "../../registry/presetViewerContribution";

export const imageViewerContribution = definePresetViewer({
  id: "image-preview",
  match: ({ document, format }) => document.type === "image" || format.defaultViewer === "image-preview",
  render: (context) => <ImageResourceViewer {...context} />,
});

export const audioViewerContribution = definePresetViewer({
  id: "audio-preview",
  match: ({ document, format }) => document.type === "audio" || format.defaultViewer === "audio-preview",
  render: (context) => <AudioResourceViewer {...context} />,
});

export const videoViewerContribution = definePresetViewer({
  id: "video-preview",
  match: ({ document, format }) => document.type === "video" || format.defaultViewer === "video-preview",
  render: (context) => <VideoResourceViewer {...context} />,
});
