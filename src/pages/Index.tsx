import { useEffect } from "react";
import { HousingDashboard } from "@/components/dashboard/HousingDashboard";
import { useMapPresence } from "@/lib/map-presence";

const Index = () => {
  const { visible } = useMapPresence();
  // The map owns the scroll lock, and only while it is mounted. It used to be an
  // unconditional `overflow: hidden` on html/body in index.css, which meant the
  // methodology page rendered its full length inside a body that could not
  // scroll — the reader saw the first screen and nothing else.
  // Hidden behind methodology the map keeps running, but that page must scroll, and the map
  // comes back at the top rather than at the reader's place in the document.
  useEffect(() => {
    if (!visible) return;
    window.scrollTo(0, 0);
    document.body.classList.add("app-scroll-locked");
    return () => document.body.classList.remove("app-scroll-locked");
  }, [visible]);

  return <HousingDashboard />;
};

export default Index;
