/** Limits enforced before and after handing a document to @iptv/xmltv. */
export interface XmltvLimits {
  maxCompressedBytes: number;
  maxExpandedBytes: number;
  maxChannels: number;
  maxPrograms: number;
  maxTextLength: number;
  maxDepth: number;
}

export interface XmltvWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface GuideChannelSnapshot {
  xmltvId: string;
  displayName: string;
}

export interface GuideProgramSnapshot {
  xmltvId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

export interface GuideSnapshot {
  channels: GuideChannelSnapshot[];
  programs: GuideProgramSnapshot[];
}
