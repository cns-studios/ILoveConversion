package main

const formatsJSON = `{
  "image_convert": {
    "input": ["jpeg","jpg","png","webp","tiff","tif","gif","avif","heif","heic","bmp"],
    "output": ["jpeg","png","webp","tiff","gif","avif","heif","bmp","pdf"]
  },
  "image_compress": {
    "input": ["jpeg","jpg","png","webp","tiff","tif","gif","avif","heif","heic","bmp"],
    "output": "same_as_input",
    "params": {"quality":{"type":"range","min":1,"max":100,"default":80},"lossless":{"type":"bool","default":false}}
  },
  "image_remove_bg": {
    "input": ["jpeg","jpg","png","webp","tiff","tif","bmp"],
    "output": ["png","webp"],
    "default_output": "png"
  },
  "pdf_compress": {
    "input": ["pdf"],
    "output": ["pdf"],
    "params": {"image_dpi":{"type":"select","options":[72,150,300,600],"default":150},"image_quality":{"type":"range","min":1,"max":100,"default":75}}
  },
  "audio_convert": {
    "input": ["mp3","wav","flac","ogg","opus","aac","m4a","aiff","wma"],
    "output": ["mp3","wav","flac","ogg","opus","aac","m4a","aiff"]
  },
  "audio_compress": {
    "input": ["mp3","wav","flac","ogg","opus","aac","m4a","aiff","wma"],
    "output": "same_as_input",
    "params": {"quality":{"type":"range","min":1,"max":100,"default":70},"lossless":{"type":"bool","default":false}}
  },
  "video_compress": {
    "input": ["mp4","mkv","webm","avi","mov"],
    "output": ["mp4","mkv","webm"],
    "params": {"quality":{"type":"range","min":1,"max":100,"default":65}}
  }
}`
