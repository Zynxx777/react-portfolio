import SmokeVisualizer from "../../components/SmokeVisualizer/SmokeVisualizer";

export const metadata = {
  title: "Visualizer | JOSHUA ZYNX",
};

export default function VisualizerPage() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000",
      }}
    >
      <SmokeVisualizer />
    </div>
  );
}
