import type { Metadata } from "next";
import ImageQuizRound from "@/components/image-round";
import type { ImageQuizQuestion } from "@/components/quiz-round";

const demoQuestions: ImageQuizQuestion[] = [
  {
    id: "lorem-mega-matcher",
    type: "image",
    prompt:
      "One mega ImageQuizRound: match eight lorem ipsum clues to ten atmospheric placeholder images.",
    descriptions: [
      { id: "desc-1", text: "Curabitur blandit tempus porttitor lorem litora torquent." },
      { id: "desc-2", text: "Praesent commodo cursus magna sed posuere consectetur." },
      { id: "desc-3", text: "Aenean lacinia bibendum nulla sed consectetur ultricies." },
      { id: "desc-4", text: "Etiam porta sem malesuada magna mollis euismod." },
      { id: "desc-5", text: "Donec sed odio dui dapibus lorem ultricies vehicula." },
      { id: "desc-6", text: "Morbi leo risus, porta ac consectetur vitae, vestibulum at eros." },
      { id: "desc-7", text: "Nulla vitae elit libero, a pharetra augue laoreet." },
      { id: "desc-8", text: "Maecenas faucibus mollis interdum aliquet dictumst." },
    ],
    images: [
      {
        id: "image-1",
        src: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder lake reflecting pine trees",
        label: "Mirror lake",
      },
      {
        id: "image-2",
        src: "https://images.unsplash.com/photo-1470770903676-69b98201ea1c?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder desert landscape",
        label: "Golden dunes",
      },
      {
        id: "image-3",
        src: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder mountain range at sunrise",
        label: "Sunrise peaks",
      },
      {
        id: "image-4",
        src: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder waterfall hidden in a forest",
        label: "Forest falls",
      },
      {
        id: "image-5",
        src: "https://images.unsplash.com/photo-1482192597420-4817fdd7e8b0?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder neon reflections on rainy street",
        label: "Neon drizzle",
      },
      {
        id: "image-6",
        src: "https://images.unsplash.com/photo-1469478712361-8df98d635967?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder rooftop garden",
        label: "Rooftop garden",
      },
      {
        id: "image-7",
        src: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder downtown skyline",
        label: "Golden skyline",
      },
      {
        id: "image-8",
        src: "https://images.unsplash.com/photo-1469478713885-ffcdfaec6820?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder aerial view of busy crosswalk",
        label: "Crosswalk rush",
      },
      {
        id: "image-9",
        src: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder coastal cliffs",
        label: "Coastal cliffs",
      },
      {
        id: "image-10",
        src: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80",
        alt: "Placeholder misty forest path",
        label: "Misty path",
      },
    ],
  },
];

export const metadata: Metadata = {
  title: "Image round demo",
  description: "Showcase of the ImageQuizRound component with placeholder content.",
};

export default function ImageRoundDemoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-zinc-100 py-16 dark:from-black dark:via-zinc-900 dark:to-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6">
        <header className="space-y-4 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-600">
            Component demo
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold text-zinc-900 dark:text-white">
              ImageQuizRound playground
            </h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Use the drag-and-drop interface below to pair each lorem ipsum description with a dummy placeholder image.
              This static page keeps all state on the client and is a quick way to verify styling, animations, and accessibility
              for the image round.
            </p>
          </div>
        </header>

        <ImageQuizRound questions={demoQuestions} />
      </main>
    </div>
  );
}
