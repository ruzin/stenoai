const logos = [
  { name: "AWS", src: "/logos/aws.svg" },
  { name: "HashiCorp", src: "/logos/hashicorp.svg" },
  { name: "Tesco", src: "/logos/tesco.svg", h: "h-10 sm:h-12" },
  { name: "Deliveroo", src: "/logos/deliveroo.svg" },
  { name: "Rutgers", src: "/logos/rutgers.svg" },
  { name: "European Union", src: "/logos/european-union.svg" },
];

export function TrustStrip() {
  return (
    <section className="py-6 md:py-8">
      <div className="container-site">
        <div className="text-center text-fg-2 text-xs tracking-[0.06em] uppercase mb-7">
          Trusted by users at
        </div>
        <div className="flex flex-wrap justify-center items-center gap-x-12 sm:gap-x-20 gap-y-6">
          {logos.map((l) => (
            <img
              key={l.name}
              src={l.src}
              alt={l.name}
              className={`${l.h || "h-6 sm:h-7"} w-auto dark:invert`}
              style={{ opacity: 0.5 }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
