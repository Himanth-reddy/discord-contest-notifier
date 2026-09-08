export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
}

export interface DiscordEmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number; // Integer RGB
  fields?: DiscordEmbedField[];
  author?: DiscordEmbedAuthor;
  footer?: DiscordEmbedFooter;
  timestamp?: string; // ISO 8601
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordDestination {
  channelId?: string | null;
  webhookUrl?: string | null;
  timezone?: string;
}
