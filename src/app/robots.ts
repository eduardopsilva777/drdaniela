import type { MetadataRoute } from "next";

/** Sistema interno: nenhuma página deve ser indexada por buscadores. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
