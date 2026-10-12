"use client";

// import { GooeyToaster } from "goey-toast";
// import "goey-toast/styles.css"; // Moving the CSS import here is also safer
import { GooeyToaster } from "@/components/ui/goey-toaster";


export default function ToasterProvider() {
    return <GooeyToaster position="top-right" theme="light" />;
}
