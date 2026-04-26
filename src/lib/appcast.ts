const sparkleNamespace = 'http://www.andymatuschak.org/xml-namespaces/sparkle';

export interface AppcastRelease {
	version: string;
	downloadUrl: string;
	releaseUrl?: string;
	minimumSystemVersion?: string;
	hardwareRequirements?: string;
	publishedAt?: string;
}

function getSparkleText(item: Element, localName: string): string | undefined {
	return item.getElementsByTagNameNS(sparkleNamespace, localName)[0]?.textContent?.trim() || undefined;
}

function getItemText(item: Element, selector: string): string | undefined {
	return item.querySelector(selector)?.textContent?.trim() || undefined;
}

export async function fetchLatestAppcastRelease(appcastUrl: string): Promise<AppcastRelease> {
	const response = await fetch(appcastUrl);
	if (!response.ok) {
		throw new Error(`Appcast request failed with status ${response.status}`);
	}

	const xml = await response.text();
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	const parseError = doc.querySelector('parsererror');
	if (parseError) {
		throw new Error('Appcast XML could not be parsed');
	}

	const latestItem = doc.querySelector('item');
	const enclosure = latestItem?.querySelector('enclosure');
	const downloadUrl = enclosure?.getAttribute('url')?.trim();
	const version = latestItem ? getSparkleText(latestItem, 'shortVersionString') : undefined;
	if (!latestItem || !downloadUrl || !version) {
		throw new Error('Appcast did not include a latest release version and download URL');
	}

	return {
		version,
		downloadUrl,
		releaseUrl: getItemText(latestItem, 'link'),
		minimumSystemVersion: getSparkleText(latestItem, 'minimumSystemVersion'),
		hardwareRequirements: getSparkleText(latestItem, 'hardwareRequirements'),
		publishedAt: getItemText(latestItem, 'pubDate'),
	};
}
