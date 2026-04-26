import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { Features } from "./sections/Features";
import { Models } from "./sections/Models";
import { Industries } from "./sections/Industries";
import { FAQ } from "./sections/FAQ";
import { CTAFooter } from "./sections/CTAFooter";
import { Footer } from "./sections/Footer";

export default function App() {
  return (
    <>
      <Nav />
      <Hero />
      <HowItWorks />
      <Features />
      <Models />
      <Industries />
      <FAQ />
      <CTAFooter />
      <Footer />
    </>
  );
}
