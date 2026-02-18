import CyberpunkRoom from "../../components/CyberpunkRoom/CyberpunkRoom";

export const metadata = {
  title: "Cyberpunk 3D Room | JOSHUA ZYNX",
  description: "An immersive cyberpunk 3D environment with interactive cursor smoke effects.",
};

export default function CyberpunkPage() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000008",
      }}
    >
      <CyberpunkRoom />
    </div>
  );
}
