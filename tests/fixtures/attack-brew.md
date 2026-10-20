# Attack Brew

A deliberately hostile brew. Every construct below tries to run script or make
the reader's browser fetch something from another origin. Rendering this file
must leave the page with **no script** and **no outbound request**.

## Scripts and frames

<script>window.__hbw_pwned = 'script';</script>

<img src="x" onerror="window.__hbw_pwned = 'img';" alt="handler">

<iframe src="https://evil.example/frame"></iframe>

<object data="https://evil.example/object"></object>

<embed src="https://evil.example/embed">

<form action="https://evil.example/post"><input name="q" value="x"></form>

\page

## Page loads

<link rel="stylesheet" href="https://evil.example/style.css">

<style>@import url("https://evil.example/import.css");</style>

<meta http-equiv="refresh" content="0;url=https://evil.example/refresh">

<base href="https://evil.example/">

<img src="https://evil.example/external.png" alt="external">

<img src="//evil.example/protocol-relative.png" alt="protocol relative">

<img srcset="https://evil.example/srcset.png 2x" src="/images/ok.png" alt="srcset">

<video poster="https://evil.example/poster.png"><source src="https://evil.example/v.mp4"></video>

<audio src="https://evil.example/a.mp3"></audio>

\page

## CSS and link tricks

<div style="background: url(https://evil.example/bg.png); color: red">url()</div>

<div style="background-image: image-set('https://evil.example/set.png' 1x); color: blue">image-set()</div>

<div style="background: u\72l(https://evil.example/escape.png); color: green">escaped url()</div>

<div style="width: expression(alert(1)); color: purple">expression()</div>

<div style="position: fixed; top: 0; left: 0; color: orange">fixed</div>

[click me](javascript:window.__hbw_pwned='href')

[data url](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

[same origin](/wiki/Manual:Test)

<img src="/images/ok.png" alt="same origin">

<img src="data:image/png;base64,AAAA" alt="inline data">
