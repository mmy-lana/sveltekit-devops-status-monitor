<script lang="ts" module>
  import type {
    Environment,
    ServerArchitecture,
    ServerAsset,
    ServerAssetDraft,
    ServerStatus,
    ValidationErrors
  } from '#lib/types/monitor';

  export interface AssetFormModalProps {
    /** Controls visibility. */
    open: boolean;
    /** Existing asset to edit. When null the form provisions a new instance. */
    server?: ServerAsset | null;
    /** Regions already in the inventory, offered as hints. */
    regions?: string[];
    /** Every name currently registered, used to reject duplicates. */
    existingNames?: string[];
    /** Dismisses the modal. */
    onclose?: () => void;
    /** Persists a new instance. */
    oncreate?: (draft: ServerAssetDraft) => unknown;
    /** Persists edits to an existing instance. */
    onupdate?: (draft: ServerAssetDraft) => unknown;
    /** Removes an existing instance. */
    ondelete?: () => unknown;
  }

  export type AssetField = keyof ValidationErrors<AssetFieldName>;

  export type AssetFieldName =
    | 'name'
    | 'hostname'
    | 'ipAddress'
    | 'region'
    | 'availabilityZone'
    | 'owner'
    | 'cpuCores'
    | 'memoryGb'
    | 'diskGb'
    | 'description';

  /** IPv4 dotted quad, each octet 0-255. */
  export const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  /** Asset names allow alphanumerics, hyphens and underscores, 3-64 chars. */
  export const NAME_PATTERN = /^[a-zA-Z0-9-_]{3,64}$/;
  /** RFC 1123 host label. */
  export const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
  /** Availability zone, e.g. `us-east-1a` or `eu-west-1-az3`. */
  export const AZ_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d[a-z]?$/i;

  const IPV6_PATTERN = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:))$/i;

  export const ENVIRONMENT_OPTIONS: readonly Environment[] = [
    'production',
    'staging',
    'development',
    'testing'
  ] as const;

  export const STATUS_OPTIONS: readonly ServerStatus[] = [
    'healthy',
    'warning',
    'critical',
    'maintenance',
    'offline'
  ] as const;

  export const ARCHITECTURE_OPTIONS: readonly ServerArchitecture[] = ['x86_64', 'arm64'] as const;

  /** Validate every field of a draft. Returns an empty object when it is valid. */
  export function validateAssetDraft(
    draft: ServerAssetDraft,
    existingNames: readonly string[] = [],
    editingId?: string
  ): ValidationErrors<AssetFieldName> {
    const errors: ValidationErrors<AssetFieldName> = {};

    if (!NAME_PATTERN.test(draft.name)) {
      errors.name = '3-64 characters using letters, digits, hyphens or underscores';
    } else if (
      existingNames.some(
        (name) => name.toLowerCase() === draft.name.toLowerCase() && name !== editingId
      )
    ) {
      errors.name = 'An instance with this name already exists';
    }

    if (draft.hostname.trim().length === 0) {
      errors.hostname = 'Hostname is required';
    } else if (!draft.hostname.split('.').every((label) => HOSTNAME_PATTERN.test(label))) {
      errors.hostname = 'Each hostname label must be alphanumeric with internal hyphens';
    }

    if (draft.ipAddress.trim().length === 0) {
      errors.ipAddress = 'IP address is required';
    } else if (!IPV4_PATTERN.test(draft.ipAddress) && !IPV6_PATTERN.test(draft.ipAddress)) {
      errors.ipAddress = 'Enter a valid IPv4 or IPv6 address';
    }

    if (draft.region.trim().length === 0) {
      errors.region = 'Region is required';
    } else if (!/^[a-z]{2}(-[a-z]+)+-\d+$/i.test(draft.region)) {
      errors.region = 'Use the AWS region format, e.g. us-east-1';
    }

    if (draft.availabilityZone.trim().length === 0) {
      errors.availabilityZone = 'Availability zone is required';
    } else if (!AZ_PATTERN.test(draft.availabilityZone)) {
      errors.availabilityZone = 'Use the AWS zone format, e.g. us-east-1a';
    } else if (!draft.availabilityZone.toLowerCase().startsWith(draft.region.toLowerCase())) {
      errors.availabilityZone = 'The availability zone must belong to the selected region';
    }

    if (draft.owner.trim().length > 64) errors.owner = 'Owner must be 64 characters or fewer';

    if (!Number.isInteger(draft.cpuCores) || draft.cpuCores < 1 || draft.cpuCores > 128) {
      errors.cpuCores = 'Enter a whole number of cores between 1 and 128';
    }
    if (!Number.isFinite(draft.memoryGb) || draft.memoryGb <= 0 || draft.memoryGb > 4096) {
      errors.memoryGb = 'Enter memory between 0.5 and 4096 GB';
    }
    if (!Number.isFinite(draft.diskGb) || draft.diskGb <= 0 || draft.diskGb > 262144) {
      errors.diskGb = 'Enter disk between 1 and 262144 GB';
    }
    if (draft.description.trim().length > 280) {
      errors.description = 'Description must be 280 characters or fewer';
    }

    return errors;
  }

  /** Build a blank draft for provisioning a new instance. */
  export function emptyDraft(): ServerAssetDraft {
    return {
      name: '',
      hostname: '',
      ipAddress: '',
      region: '',
      availabilityZone: '',
      environment: 'production',
      status: 'healthy',
      description: '',
      owner: '',
      provisionedBy: 'terraform',
      cpuCores: 4,
      memoryGb: 16,
      diskGb: 100,
      architecture: 'x86_64',
      tags: [{ key: 'team', value: '' }]
    };
  }

  /** Build a draft from an existing asset so the form opens fully populated. */
  export function draftFromServer(server: ServerAsset): ServerAssetDraft {
    const tags = Object.entries(server.tags).map(([key, value]) => ({ key, value }));
    return {
      name: server.name,
      hostname: server.hostname,
      ipAddress: server.ipAddress,
      region: server.region,
      availabilityZone: server.availabilityZone,
      environment: server.environment,
      status: server.status,
      description: server.description ?? '',
      owner: server.owner ?? '',
      provisionedBy: server.provisionedBy ?? '',
      cpuCores: server.specs.cpuCores,
      memoryGb: server.specs.memoryGb,
      diskGb: server.specs.diskGb,
      architecture: server.specs.architecture,
      tags: tags.length > 0 ? tags : [{ key: '', value: '' }]
    };
  }
</script>

<script lang="ts">
  import Button from '#lib/components/primitives/Button.svelte';
  import Input from '#lib/components/primitives/Input.svelte';
  import Select from '#lib/components/primitives/Select.svelte';
  import { slugifyAssetName } from '#lib/utils/id';

  let {
    open,
    server = null,
    regions = [],
    existingNames = [],
    onclose,
    oncreate,
    onupdate,
    ondelete
  }: AssetFormModalProps = $props();

  let draft = $state<ServerAssetDraft>(emptyDraft());
  let errors = $state<ValidationErrors<AssetFieldName>>({});
  let submitError = $state<string | null>(null);
  let busy = $state(false);
  let confirmDelete = $state(false);
  let hydratedFor = $state<string | null>(null);

  const isEditing = $derived(Boolean(server));
  const heading = $derived(isEditing ? 'Edit instance' : 'Register instance');

  // Re-hydrate the form whenever a different asset is opened (or closed).
  $effect(() => {
    const key = server?.id ?? (open ? 'new' : null);
    if (key === null) {
      hydratedFor = null;
      return;
    }
    if (hydratedFor === key) return;
    hydratedFor = key;
    draft = server ? draftFromServer(server) : emptyDraft();
    errors = {};
    submitError = null;
    confirmDelete = false;
  });

  function field<K extends keyof ServerAssetDraft>(key: K, value: ServerAssetDraft[K]) {
    draft = { ...draft, [key]: value };
    if (errors[key as AssetFieldName]) {
      const next = { ...errors };
      delete next[key as AssetFieldName];
      errors = next;
    }
  }

  function numberField(key: 'cpuCores' | 'memoryGb' | 'diskGb', raw: string) {
    const parsed = Number(raw);
    field(key, (Number.isFinite(parsed) ? parsed : Number.NaN) as never);
  }

  function setTag(index: number, key: string, value: string) {
    const tags = draft.tags.map((tag, i) => (i === index ? { key, value } : tag));
    field('tags', tags);
  }

  function addTag() {
    if (draft.tags.length >= 10) return;
    field('tags', [...draft.tags, { key: '', value: '' }]);
  }

  function removeTag(index: number) {
    field(
      'tags',
      draft.tags.filter((_, i) => i !== index)
    );
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open && !busy) onclose?.();
  }

  async function submit() {
    const found = validateAssetDraft(draft, existingNames, server?.id);
    errors = found;
    if (Object.keys(found).length > 0) {
      document.querySelector<HTMLElement>('[data-testid="asset-form"] [data-error="true"]')?.focus();
      return;
    }

    busy = true;
    submitError = null;
    try {
      if (isEditing) await onupdate?.(draft);
      else await oncreate?.(draft);
    } catch (error) {
      submitError = error instanceof Error ? error.message : 'The instance could not be saved';
    } finally {
      busy = false;
    }
  }

  async function remove() {
    busy = true;
    submitError = null;
    try {
      await ondelete?.();
    } catch (error) {
      submitError = error instanceof Error ? error.message : 'The instance could not be removed';
    } finally {
      busy = false;
      confirmDelete = false;
    }
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
    <button
      type="button"
      aria-label="Close the instance form"
      tabindex={-1}
      class="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      onclick={() => {
        if (!busy) onclose?.();
      }}
    ></button>

    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-form-title"
      data-testid="asset-form"
      class="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-xl border border-slate-border-strong bg-slate-card shadow-overlay sm:max-w-[720px] sm:rounded-xl"
    >
      <header class="flex items-center justify-between gap-3 border-b border-slate-border px-4 py-3">
        <div class="min-w-0">
          <h2 id="asset-form-title" class="text-[13px] font-semibold text-cw-text">{heading}</h2>
          <p class="mt-0.5 truncate font-mono text-[10px] text-cw-faint">
            {isEditing ? server?.id : 'Provisioning a new inventory entry'}
          </p>
        </div>
        <Button
          variant="icon"
          size="sm"
          testId="asset-close"
          ariaLabel="Close the instance form"
          onclick={() => {
            if (!busy) onclose?.();
          }}
        >
          <svg
            viewBox="0 0 16 16"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path d="m4 4 8 8M12 4l-8 8" stroke-linecap="round" />
          </svg>
        </Button>
      </header>

      <form
        class="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        novalidate
        onsubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {#if submitError}
          <p
            class="mb-3 rounded border border-cw-rose/40 bg-cw-rose/10 px-3 py-2 text-[11px] text-cw-rose"
            role="alert"
            data-testid="asset-form-error"
          >
            {submitError}
          </p>
        {:else if Object.keys(errors).length > 0}
          <p
            class="mb-3 rounded border border-cw-amber/40 bg-cw-amber/10 px-3 py-2 text-[11px] text-cw-amber"
            role="alert"
            data-testid="asset-form-error"
          >
            {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? '' : 's'} need
            attention before this instance can be saved.
          </p>
        {/if}

        <fieldset class="flex flex-col gap-3">
          <legend class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-cw-faint">
            Identity
          </legend>

          <div class="grid gap-3 sm:grid-cols-2">
            <Input
              label="Instance name"
              name="asset-name"
              testId="asset-name"
              required
              placeholder="prod-use1-api-gw-09"
              value={draft.name}
              error={errors.name}
              hint="Letters, digits, hyphens and underscores. 3-64 characters."
              oninput={(event) => field('name', event.currentTarget.value)}
            />
            <Input
              label="Hostname"
              name="asset-hostname"
              testId="asset-hostname"
              required
              placeholder="api-gw-09.us-east-1.internal"
              value={draft.hostname}
              error={errors.hostname}
              oninput={(event) => field('hostname', event.currentTarget.value)}
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <Input
              label="IP address"
              name="asset-ip"
              testId="asset-ip"
              required
              placeholder="10.0.12.6"
              value={draft.ipAddress}
              error={errors.ipAddress}
              hint="IPv4 or IPv6."
              oninput={(event) => field('ipAddress', event.currentTarget.value)}
            />
            <Select
              label="Environment"
              name="asset-environment"
              testId="asset-environment"
              options={ENVIRONMENT_OPTIONS.map((value) => ({ value, label: value }))}
              value={draft.environment}
              onchange={(event) =>
                field('environment', event.currentTarget.value as Environment)}
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <Input
              label="Region"
              name="asset-region"
              testId="asset-region"
              required
              placeholder="us-east-1"
              value={draft.region}
              error={errors.region}
              hint={regions.length > 0 ? `In use: ${regions.slice(0, 3).join(', ')}` : 'AWS region format'}
              oninput={(event) => field('region', event.currentTarget.value)}
            />
            <Input
              label="Availability zone"
              name="asset-az"
              testId="asset-az"
              required
              placeholder="us-east-1a"
              value={draft.availabilityZone}
              error={errors.availabilityZone}
              oninput={(event) => field('availabilityZone', event.currentTarget.value)}
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <!--
              No leading adornment here: a status Badge rendered inside the
              select icon slot overlapped the selected value and read as
              "HEALhealthy". The selected status is rendered by the control
              itself, and the live preview lives directly below the field.
            -->
            <!--
              No adornment and no preview row here: both misaligned this field
              against its neighbours. The selected lifecycle state is already
              communicated by the capitalised option text in the control, and
              the Badge preview lives in the instance table and detail view.
            -->
            <Select
              label="Lifecycle status"
              name="asset-status"
              testId="asset-status"
              options={STATUS_OPTIONS.map((value) => ({
                value,
                label: value.charAt(0).toUpperCase() + value.slice(1)
              }))}
              value={draft.status}
              onchange={(event) => field('status', event.currentTarget.value as ServerStatus)}
            />
            <Input
              label="Owner"
              name="asset-owner"
              testId="asset-owner"
              placeholder="platform-team"
              value={draft.owner}
              error={errors.owner}
              oninput={(event) => field('owner', event.currentTarget.value)}
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <Input
              label="Provisioned by"
              name="asset-provisioner"
              testId="asset-provisioner"
              placeholder="terraform"
              value={draft.provisionedBy}
              oninput={(event) => field('provisionedBy', event.currentTarget.value)}
            />
            <Input
              label="Description"
              name="asset-description"
              testId="asset-description"
              placeholder="What this instance is responsible for"
              value={draft.description}
              error={errors.description}
              oninput={(event) => field('description', event.currentTarget.value)}
            />
          </div>
        </fieldset>

        <fieldset class="mt-5 flex flex-col gap-3">
          <legend class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-cw-faint">
            Capacity
          </legend>
          <div class="grid gap-3 sm:grid-cols-4">
            <Input
              label="vCPU cores"
              name="asset-cpu"
              testId="asset-cpu"
              type="number"
              inputmode="numeric"
              min={1}
              max={128}
              step={1}
              value={Number.isFinite(draft.cpuCores) ? String(draft.cpuCores) : ''}
              error={errors.cpuCores}
              oninput={(event) => numberField('cpuCores', event.currentTarget.value)}
            />
            <Input
              label="Memory (GB)"
              name="asset-memory"
              testId="asset-memory"
              type="number"
              inputmode="decimal"
              min={0.5}
              max={4096}
              step={0.5}
              value={Number.isFinite(draft.memoryGb) ? String(draft.memoryGb) : ''}
              error={errors.memoryGb}
              oninput={(event) => numberField('memoryGb', event.currentTarget.value)}
            />
            <Input
              label="Disk (GB)"
              name="asset-disk"
              testId="asset-disk"
              type="number"
              inputmode="decimal"
              min={1}
              max={262144}
              step={1}
              value={Number.isFinite(draft.diskGb) ? String(draft.diskGb) : ''}
              error={errors.diskGb}
              oninput={(event) => numberField('diskGb', event.currentTarget.value)}
            />
            <Select
              label="Architecture"
              name="asset-architecture"
              testId="asset-architecture"
              options={ARCHITECTURE_OPTIONS.map((value) => ({ value, label: value }))}
              value={draft.architecture}
              onchange={(event) =>
                field('architecture', event.currentTarget.value as ServerArchitecture)}
            />
          </div>
        </fieldset>

        <fieldset class="mt-5 flex flex-col gap-2">
          <legend class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-cw-faint">
            Tags
          </legend>
          {#each draft.tags as tag, index (index)}
            <!-- items-end baselines the delete button with the input box itself
                 rather than centring it across the 65px label+control stack. -->
            <div class="flex items-end gap-2">
              <Input
                label={`Tag ${index + 1} key`}
                name={`asset-tag-key-${index}`}
                value={tag.key}
                placeholder="service"
                oninput={(event) => setTag(index, event.currentTarget.value, tag.value)}
              />
              <Input
                label={`Tag ${index + 1} value`}
                name={`asset-tag-value-${index}`}
                value={tag.value}
                placeholder="gateway"
                oninput={(event) => setTag(index, tag.key, event.currentTarget.value)}
              />
              <Button
                variant="icon"
                size="sm"
                testId={`asset-tag-remove-${index}`}
                ariaLabel={`Remove tag ${index + 1}`}
                onclick={() => removeTag(index)}
              >
                <svg
                  viewBox="0 0 16 16"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <path d="m4 4 8 8M12 4l-8 8" stroke-linecap="round" />
                </svg>
              </Button>
            </div>
          {/each}
          <Button
            variant="ghost"
            size="sm"
            testId="asset-tag-add"
            onclick={addTag}
            disabled={draft.tags.length >= 10}
          >
            Add tag
          </Button>
        </fieldset>
      </form>

      <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-border px-4 py-3">
        {#if isEditing}
          {#if confirmDelete}
            <div class="flex items-center gap-2" data-testid="asset-delete-confirm">
              <span class="text-[11px] text-cw-rose">Remove this instance and its telemetry?</span>
              <Button variant="danger" size="sm" testId="asset-delete-confirm-yes" loading={busy} onclick={remove}>
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onclick={() => (confirmDelete = false)}>
                Cancel
              </Button>
            </div>
          {:else}
            <Button variant="danger" size="sm" testId="asset-delete" onclick={() => (confirmDelete = true)}>
              De-register
            </Button>
          {/if}
        {:else}
          <span class="text-[11px] text-cw-faint">
            Generated id will look like <span class="font-mono">srv-{slugifyAssetName(draft.name) || '…'}</span>
          </span>
        {/if}

        <div class="flex items-center gap-2">
          <Button variant="ghost" size="md" testId="asset-cancel" onclick={() => onclose?.()} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="md" testId="asset-submit" loading={busy} onclick={submit}>
            {isEditing ? 'Save changes' : 'Register instance'}
          </Button>
        </div>
      </footer>
    </div>
  </div>
{/if}
