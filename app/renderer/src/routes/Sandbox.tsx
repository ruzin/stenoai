import * as React from 'react';
import { Search, FolderPlus, Plus, Copy, Check, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Chip } from '@/components/ui/chip';
import { Row } from '@/components/ui/row';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Display,
  H1,
  H2,
  H3,
  Lead,
  Muted,
} from '@/components/ui/typography';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface SectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
  hint?: string;
}

function Section({ id, title, hint, children }: SectionProps) {
  return (
    <section
      id={id}
      data-sandbox-section={id}
      className="space-y-4 border-b border-border pb-10"
    >
      <header className="space-y-1">
        <H3 className="text-foreground">{title}</H3>
        {hint && <Muted>{hint}</Muted>}
      </header>
      {children}
    </section>
  );
}

function Stack({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex w-40 items-center gap-3 rounded-md border border-border p-2">
      <div
        aria-hidden
        className="size-8 rounded"
        style={{ background: value }}
      />
      <div className="flex flex-col text-xs leading-tight">
        <span className="font-medium text-foreground">{name}</span>
        <span className="font-mono text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}

export function Sandbox() {
  const { theme, setTheme, resolved } = useTheme();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[960px] px-8 pb-24 pt-12">
        <div className="mb-12 flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Display>Steno sandbox</Display>
            <Lead>
              Visual approval surface for the core component library. Every
              state, both themes. Sign-off gates screen assembly.
            </Lead>
            <Muted>
              Active theme: <span className="font-medium text-foreground">{resolved}</span>{' '}
              (preference: {theme})
            </Muted>
          </div>
          <div className="flex shrink-0 items-center gap-2" data-no-screenshot>
            <Button
              variant={theme === 'light' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('light')}
            >
              Light
            </Button>
            <Button
              variant={theme === 'dark' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('dark')}
            >
              Dark
            </Button>
            <Button
              variant={theme === 'system' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('system')}
            >
              System
            </Button>
          </div>
        </div>

        <div className="space-y-10">
          <Section
            id="typography"
            title="Typography"
            hint="Charter serif for display + H1/H2. Inter for body. JetBrains Mono for code."
          >
            <div className="space-y-3">
              <Display>Display — welcome back.</Display>
              <H1>H1 — meetings overview</H1>
              <H2>H2 — Tuesday, 14 March</H2>
              <H3>H3 — section heading</H3>
              <Lead>
                Lead — this is what a paragraph lead reads like in the Steno design
                system. It stays on muted-foreground until you need emphasis.
              </Lead>
              <Muted>Muted — smaller secondary copy.</Muted>
              <p className="font-mono text-sm">mono — 00:47:12 · whisper-base.en</p>
            </div>
          </Section>

          <Section id="palette" title="Palette" hint="Paper → ink ramp + brand accents.">
            <Stack label="Paper">
              <Swatch name="paper-0" value="var(--steno-paper-0)" />
              <Swatch name="paper-1" value="var(--steno-paper-1)" />
              <Swatch name="paper-2" value="var(--steno-paper-2)" />
            </Stack>
            <Stack label="Ink">
              <Swatch name="ink-900" value="var(--steno-ink-900)" />
              <Swatch name="ink-500" value="var(--steno-ink-500)" />
            </Stack>
            <Stack label="Signal">
              <Swatch name="recording" value="var(--steno-recording)" />
            </Stack>
          </Section>

          <Section id="buttons" title="Buttons" hint="Variant × size × disabled matrix.">
            <Stack label="Variants (size=default)">
              <Button>Default</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </Stack>
            <Stack label="Sizes">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Add">
                <Plus />
              </Button>
            </Stack>
            <Stack label="With icon">
              <Button variant="outline">
                <Copy /> Copy summary
              </Button>
              <Button variant="default">
                <Check /> Saved
              </Button>
              <Button variant="destructive">
                <Mic /> Record
              </Button>
            </Stack>
            <Stack label="Disabled">
              <Button disabled>Default</Button>
              <Button variant="outline" disabled>
                Outline
              </Button>
              <Button variant="destructive" disabled>
                Destructive
              </Button>
            </Stack>
          </Section>

          <Section id="inputs" title="Inputs" hint="Text entry + search + textarea.">
            <Stack label="Variants">
              <div className="w-80">
                <Input placeholder="Default input" />
              </div>
              <div className="w-80">
                <Input
                  variant="sunken"
                  iconStart={<Search className="size-4" />}
                  placeholder="Search meetings"
                />
              </div>
              <div className="w-80">
                <Input variant="inherit" placeholder="Inherit — used in inline rename" />
              </div>
            </Stack>
            <Stack label="Sizes">
              <div className="w-64">
                <Input size="sm" placeholder="Small" />
              </div>
              <div className="w-64">
                <Input placeholder="Default" />
              </div>
              <div className="w-64">
                <Input size="lg" placeholder="Large" />
              </div>
            </Stack>
            <Stack label="States">
              <div className="w-64">
                <Input placeholder="Empty" />
              </div>
              <div className="w-64">
                <Input defaultValue="Filled content" />
              </div>
              <div className="w-64">
                <Input disabled placeholder="Disabled" />
              </div>
            </Stack>
            <Stack label="Textarea">
              <div className="w-[480px]">
                <Textarea
                  placeholder="Paste transcript or type a note — auto-resizes."
                  autoResize
                />
              </div>
            </Stack>
          </Section>

          <Section id="chips" title="Chips" hint="Used for tags, prompts, filter pills.">
            <Stack label="Variants">
              <Chip>Unread</Chip>
              <Chip variant="muted">Clients</Chip>
              <Chip variant="destructive">Failed</Chip>
            </Stack>
            <Stack label="Interactive (onClick)">
              <Chip
                variant="muted"
                onClick={() => {}}
                aria-label="What was decided"
              >
                What was decided?
              </Chip>
              <Chip variant="muted" onClick={() => {}}>
                Summarize action items
              </Chip>
              <Chip variant="muted" onClick={() => {}}>
                Who owns follow-up?
              </Chip>
            </Stack>
          </Section>

          <Section
            id="rows"
            title="Rows"
            hint="Sidebar entries, settings nav, folder headers."
          >
            <div className="w-[320px] space-y-1 rounded-md border border-border p-2">
              <Row
                size="sm"
                label="Clients"
                collapsible
                open
                trailing={2}
                onClick={() => {}}
                className="text-muted-foreground"
              />
              <div className="pl-4">
                <Row
                  label="Acme Corp — quarterly review"
                  trailing="Tue"
                  onClick={() => {}}
                />
                <Row
                  label="Nova Labs — roadmap"
                  trailing="Apr 14"
                  active
                  onClick={() => {}}
                />
              </div>
              <Row
                size="sm"
                label="Research"
                collapsible
                trailing={1}
                onClick={() => {}}
                className="text-muted-foreground"
              />
            </div>
            <Stack label="Sizes">
              <div className="w-[320px] space-y-1">
                <Row size="sm" label="Small row" trailing="Fri" onClick={() => {}} />
                <Row size="md" label="Medium row (default)" trailing="3" onClick={() => {}} />
                <Row size="lg" label="Large row" trailing="Active" onClick={() => {}} />
              </div>
            </Stack>
            <Stack label="States">
              <div className="w-[320px] space-y-1">
                <Row label="Default" onClick={() => {}} />
                <Row label="Active" active onClick={() => {}} />
                <Row label="Static (no onClick)" />
                <Row
                  label="Collapsible, closed"
                  collapsible
                  trailing={4}
                  onClick={() => {}}
                />
                <Row
                  label="Collapsible, open"
                  collapsible
                  open
                  trailing={4}
                  onClick={() => {}}
                />
              </div>
            </Stack>
          </Section>

          <Section id="cards" title="Cards" hint="Flat by default; raised + padded as variants.">
            <Stack label="Flat (default)">
              <Card className="w-[320px]">
                <CardHeader>
                  <CardTitle>Team sync — product planning</CardTitle>
                  <CardDescription>Today · 38 min</CardDescription>
                </CardHeader>
                <CardContent>
                  <Muted>
                    Reviewed Q2 roadmap, debated the renderer rework scope, closed out
                    the open ADRs.
                  </Muted>
                </CardContent>
              </Card>
            </Stack>
            <Stack label="Raised + padded">
              <Card raised padded className="w-[320px]">
                <CardHeader>
                  <CardTitle>Onboarding call with Ava</CardTitle>
                  <CardDescription>Mon · 22 min</CardDescription>
                </CardHeader>
                <CardContent>
                  <Muted>
                    Ava walked through her customer discovery process, we mapped the
                    ICP she has in mind to the wedge we've been debating.
                  </Muted>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" size="sm">
                    <Copy /> Copy summary
                  </Button>
                </CardFooter>
              </Card>
            </Stack>
          </Section>

          <Section id="dialog" title="Dialog" hint="Radix-backed modal. Open state rendered below for screenshot.">
            <Stack label="Trigger">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <FolderPlus /> New folder
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New folder</DialogTitle>
                    <DialogDescription>
                      Group related meetings together. Folder names are only visible
                      to you.
                    </DialogDescription>
                  </DialogHeader>
                  <Input placeholder="e.g. Acme Corp" defaultValue="" autoFocus />
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button>Create folder</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </Stack>
          </Section>

          <Section id="tabs" title="Tabs" hint="Used in settings + meeting detail.">
            <div className="w-[520px]">
              <Tabs defaultValue="summary">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="transcript">Transcript</TabsTrigger>
                  <TabsTrigger value="chat">Chat</TabsTrigger>
                </TabsList>
                <TabsContent value="summary">
                  <Muted>Summary pane — headline, key points, action items.</Muted>
                </TabsContent>
                <TabsContent value="transcript">
                  <Muted>Transcript pane — virtualized list of segments.</Muted>
                </TabsContent>
                <TabsContent value="chat">
                  <Muted>Chat pane — streaming Q&A with transcript.</Muted>
                </TabsContent>
              </Tabs>
            </div>
          </Section>

          <Section id="recording" title="Recording indicator" hint="Dot + pulse animation (used in titlebar).">
            <Stack label="Live">
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <span className="recording-dot" />
                <span className="font-mono text-sm tabular-nums">00:12:04</span>
              </div>
            </Stack>
          </Section>
        </div>
      </div>
    </div>
  );
}
