/**
 * Texto del waiver (release of liability) — versionado.
 *
 * Fuente: "RELEASE AND WAIVER OF LIABILITY, ASSUMPTION OF RISK AND INDEMNITY
 * AGREEMENT — Surf Lessons and Surfboards Rentals — More Surf Shop".
 *
 * TODO (riesgo crítico de la Hoja de Ruta): este texto y el mecanismo de
 * aceptación electrónica deben ser revisados por un abogado de Costa Rica
 * antes de salir a producción. Al cambiar el texto, subir WAIVER_VERSION.
 *
 * Módulo puro (sin imports de server): lo consumen tanto la API como la isla
 * de React del flujo de reserva, para que lo mostrado sea idéntico a lo que
 * se guarda en waivers.rendered_text_snapshot.
 */

export const WAIVER_VERSION = '2026-09-05';

export const WAIVER_RELEASEE = {
  legalName: 'EL TIEMPO DEL MAR MS SOCIEDAD ANONIMA',
  commercialName: 'More Surf Shop',
  idNumber: '3-101-873679',
} as const;

export const WAIVER_TITLE =
  'Release and Waiver of Liability, Assumption of Risk and Indemnity Agreement';

export const WAIVER_SUBTITLE = 'Surf Lessons and Surfboard Rentals — More Surf Shop';

/**
 * Cláusulas del cuerpo del acuerdo. La primera interpola la actividad
 * contratada. Se usa igual desde el UI y desde renderWaiverText().
 */
export function getWaiverClauses(activity: string): string[] {
  return [
    `In order to hire the services of the Releasee for the activity or service of ${activity}, I fully understand the nature of this activity or service, and accept that I am qualified, in good health and in a proper physical condition to participate in such activity.`,
    `I acknowledge that if I believe the conditions are unsafe, I will immediately discontinue participation in the activity, and I will attend to all the recommendations and instructions that I receive from the Releasee or its employees.`,
    `I also understand that this activity involves risks of serious physical injury, including permanent disability, paralysis and death, which may be caused by my own actions or inactions, the actions or inactions of others participating in the lessons or the activity, the conditions in which the activity takes place, or the negligence of the Releasee; and that there may be other risks either known or not known to me or not foreseeable at this time; and I fully accept and assume all such risks and all responsibility for the losses, costs and damages I incur as a result of my participation in the activity or service.`,
    `I hereby release, discharge and covenant not to sue the Releasee and its respective administrators, directors, agents, officers, volunteers and employees, other participants, any sponsors, advertisers, and, if applicable, owners and lessors of the premises on which I hire the activity — each considered one of the "Releasees" herein — from all liability, claims, demands, losses or damages on my account caused or alleged to be caused in whole or in part by the negligence of the "Releasees" or otherwise, including negligent rescue operations; and I further agree that if, despite this release, waiver of liability and assumption of risk, I or anyone on my behalf makes a claim against any of the Releasees, I will indemnify, save and hold harmless each of the Releasees from any loss, liability, damage or cost they may incur as the result of such claim.`,
  ];
}

export const WAIVER_ACKNOWLEDGEMENT =
  'I have read this Release and Waiver of Liability, Assumption of Risk and Indemnity Agreement, understand that I have given up substantial rights by accepting it, and accept it freely and without any inducement or assurance of any nature; I intend it to be a complete and unconditional release of all liability to the greatest extent allowed by the law of Costa Rica; and I agree that if any portion of this agreement is held to be invalid, the remainder shall continue in full force and effect.';

export interface WaiverRenderOpts {
  activity: string;
  signerName: string;
  signedAtISO: string;
  isMinor: boolean;
  guardianName?: string | null;
}

/**
 * Texto plano completo para guardar en waivers.rendered_text_snapshot:
 * título + partes releasee + cláusulas + reconocimiento + bloque de
 * aceptación electrónica con los datos de la firma.
 */
export function renderWaiverText(o: WaiverRenderOpts): string {
  const lines: string[] = [
    WAIVER_TITLE.toUpperCase(),
    WAIVER_SUBTITLE,
    '',
    `Releasee: ${WAIVER_RELEASEE.legalName} (commercial name: ${WAIVER_RELEASEE.commercialName}), corporate ID ${WAIVER_RELEASEE.idNumber}.`,
    '',
  ];
  for (const clause of getWaiverClauses(o.activity)) {
    lines.push(clause, '');
  }
  lines.push(WAIVER_ACKNOWLEDGEMENT, '', '- - -');
  lines.push(`Accepted electronically by ${o.signerName} on ${o.signedAtISO}.`);
  if (o.isMinor) {
    lines.push(
      `Accepted on behalf of a minor by the parent or legal guardian: ${
        o.guardianName?.trim() || o.signerName
      }.`,
    );
  }
  lines.push(`Waiver version: ${WAIVER_VERSION}.`);
  return lines.join('\n');
}
