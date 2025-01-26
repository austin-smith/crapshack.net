function randomtext() {
    var randomtxt = [
        'thank u for coming soon',
        'same as it ever was',
        'smile and wave',
		'and the days go by',
		'insert good text before publish',
		'mediocre at best',
		'website for u',
		'powered by quiet noise',
		'product of lost imagination',
		'nearing the end',
		'website for to comfort',
		'on its last legs',
		'better days to come',
		'shut up kiss me hold me tight',
		'a dead dream',
		'please clap',
		'this must be the place'
	];
    return randomtxt[Math.floor((Math.random() * 16.99))];
}

document.getElementById("words").innerHTML = randomtext();