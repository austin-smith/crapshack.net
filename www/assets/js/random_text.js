function randomtext() {
    var randomtxt = [
	'deeply\, unfathomably\, senselessly\, terribly',
	'deeply\, unfathomably\, senselessly\, terribly',
	'deeply\, unfathomably\, senselessly\, terribly',
	'everything on earth with you',
	'in case you ever foolishly forget',
	'desperate attempt to sound like someone new',
	'obscure popular culture',
	'untenable but inalterable',
	'it\'s got lots to do with magnets',
	'on its last legs',
	'better days to come',
	'please clap',
	'smile and wave',
	'a dead dream',
	'it doesn\'t even matter',
	'same as it ever was',
	'and the days go by',
	'powered by quiet noise',
	'product of lost imagination',
	'website for u',
	'website for no one',
	'website for to comfort',
	'nearing the end',
	'mediocre at best',
	'dad\'s favorite',
	'shut up kiss me hold me tight'
	];
    return randomtxt[Math.floor((Math.random() * 27.99))];
}

document.getElementById("words").innerHTML = randomtext();
