"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export interface TrendDatum {
  key: string;
  label: string;
  value: number;
}

const config = {
  value: { label: "Leads novos", color: "var(--chart-accent)" },
} satisfies ChartConfig;

/**
 * Evolução de leads novos: uma série (sem caixa de legenda — o título a nomeia),
 * colunas finas com ponta arredondada, grade horizontal recessiva e tooltip por
 * coluna. A tabela equivalente fica disponível para leitores de tela.
 */
export function LeadsTrendChart({ data, caption }: { data: TrendDatum[]; caption: string }) {
  const max = Math.max(0, ...data.map((item) => item.value));
  const tickInterval = data.length > 16 ? Math.ceil(data.length / 8) - 1 : 0;

  return (
    <figure className="space-y-2">
      <ChartContainer config={config} className="aspect-auto h-56 w-full" aria-hidden>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickMargin={8}
            interval={tickInterval}
            minTickGap={4}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} domain={[0, Math.max(4, max)]} />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<ChartTooltipContent hideIndicator={false} />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ChartContainer>
      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col">Leads novos</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td>{item.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
