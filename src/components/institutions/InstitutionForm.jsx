import React, { useMemo, useRef, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { UploadFile } from '@/api/integrations';
import { Upload, Loader2, X, ImagePlus } from 'lucide-react';

const PROVINCES = [
  { value: 'ON', label: 'Ontario' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'AB', label: 'Alberta' },
  { value: 'QC', label: 'Quebec' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'YT', label: 'Yukon' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' }
];

const VERIFICATION_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'unclaimed', label: 'Unclaimed' },
  { value: 'claimed', label: 'Claimed' }
];

const INSTITUTION_TYPE_OPTIONS = [
  { value: 'university', label: 'University' },
  { value: 'college', label: 'College' },
  { value: 'language_school', label: 'Language School' },
  { value: 'high_school', label: 'High School' },
  { value: 'private_career_college', label: 'Private Career College' },
  { value: 'vocational_school', label: 'Vocational School' },
  { value: 'other', label: 'Other' }
];

const SCHOOL_LEVEL_OPTIONS = [
  { value: 'undergraduate', label: 'Undergraduate' },
  { value: 'postgraduate', label: 'Postgraduate' },
  { value: 'college', label: 'College' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'language', label: 'Language' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' }
];

const firstDefined = (...values) => values.find(
  (value) => value !== undefined && value !== null && value !== ''
);

const parseNumber = (value, fallback = 0) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

export default function InstitutionForm({ institution, onSave, onCancel }) {
  const logoInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const initialImageUrls = useMemo(() => {
    const rawImageUrls = institution?.imageUrls || institution?.images || [];
    const normalized = Array.isArray(rawImageUrls)
      ? rawImageUrls.filter(Boolean)
      : [];

    const singleImageUrl = firstDefined(institution?.imageUrl, institution?.image);
    if (singleImageUrl && !normalized.includes(singleImageUrl)) {
      normalized.unshift(singleImageUrl);
    }

    return normalized;
  }, [institution]);

  const [formData, setFormData] = useState({
    name: institution?.name || '',
    user_id: firstDefined(institution?.user_id, institution?.owner_user_id, institution?.uid, ''),
    verification_status: firstDefined(institution?.verification_status, institution?.status, 'pending'),

    city: institution?.city || '',
    province: institution?.province || '',
    country: institution?.country || 'Canada',
    address: institution?.address || '',

    logoUrl: institution?.logoUrl || '',
    bannerUrl: firstDefined(institution?.bannerUrl, institution?.banner, ''),
    imageUrls: initialImageUrls,

    about: institution?.about || '',
    website: institution?.website || '',
    email: institution?.email || '',
    phone: institution?.phone || '',

    dliNumber: firstDefined(institution?.dliNumber, institution?.dli_number, ''),
    type: firstDefined(institution?.type, institution?.school_type, ''),
    school_level: institution?.school_level || '',

    year_established: firstDefined(institution?.year_established, institution?.founded_year, ''),
    application_fee: firstDefined(institution?.application_fee, ''),
    cost_of_living: firstDefined(institution?.cost_of_living, ''),

    isFeatured: institution?.isFeatured || false,
    popularityScore: parseNumber(institution?.popularityScore, 0),
    rankScore: parseNumber(institution?.rankScore, 0),
    tags: ensureArray(institution?.tags).join(', '),
    programCount: parseNumber(institution?.programCount, 0),
    avgTuition: parseNumber(institution?.avgTuition, 0),
    isPublic: institution?.isPublic !== false,
    hasCoop: institution?.hasCoop || false,
    isDLI: institution?.isDLI !== false
  });

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const uploadSingleImage = async (file, field, setUploading) => {
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await UploadFile({ file });
      setFormData((prev) => ({ ...prev, [field]: file_url }));
    } catch (error) {
      console.error(`Error uploading ${field}:`, error);
      alert(`Failed to upload ${field}. Please try again.`);
    } finally {
      setUploading(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    await uploadSingleImage(file, 'logoUrl', setUploadingLogo);
    e.target.value = '';
  };

  const handleBannerUpload = async (e) => {
    const file = e.target.files?.[0];
    await uploadSingleImage(file, 'bannerUrl', setUploadingBanner);
    e.target.value = '';
  };

  const handleGalleryUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploadingGallery(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const { file_url } = await UploadFile({ file });
        if (file_url) uploadedUrls.push(file_url);
      }

      setFormData((prev) => ({
        ...prev,
        imageUrls: [...prev.imageUrls, ...uploadedUrls]
      }));
    } catch (error) {
      console.error('Error uploading gallery images:', error);
      alert('Failed to upload one or more gallery images. Please try again.');
    } finally {
      setUploadingGallery(false);
      e.target.value = '';
    }
  };

  const removeGalleryImage = (urlToRemove) => {
    setFormData((prev) => ({
      ...prev,
      imageUrls: prev.imageUrls.filter((url) => url !== urlToRemove)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const cleanedImageUrls = ensureArray(formData.imageUrls);
    const cleanedTags = ensureArray(formData.tags);

    const submitData = {
      name: formData.name.trim(),
      user_id: formData.user_id.trim(),
      verification_status: formData.verification_status,

      city: formData.city.trim(),
      province: formData.province,
      country: formData.country.trim(),
      address: formData.address.trim(),

      logoUrl: formData.logoUrl.trim(),
      bannerUrl: formData.bannerUrl.trim(),
      imageUrls: cleanedImageUrls,
      imageUrl: cleanedImageUrls[0] || '',

      about: formData.about.trim(),
      website: formData.website.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),

      dliNumber: formData.dliNumber.trim(),
      dli_number: formData.dliNumber.trim(),

      type: formData.type,
      school_type: formData.type,
      school_level: formData.school_level,

      year_established: formData.year_established === '' ? null : parseNumber(formData.year_established, null),
      founded_year: formData.year_established === '' ? null : parseNumber(formData.year_established, null),

      application_fee: formData.application_fee === '' ? null : parseNumber(formData.application_fee, null),
      cost_of_living: formData.cost_of_living === '' ? null : parseNumber(formData.cost_of_living, null),

      isFeatured: !!formData.isFeatured,
      popularityScore: parseNumber(formData.popularityScore, 0),
      rankScore: parseNumber(formData.rankScore, 0),
      tags: cleanedTags,
      programCount: parseNumber(formData.programCount, 0),
      avgTuition: parseNumber(formData.avgTuition, 0),
      isPublic: !!formData.isPublic,
      hasCoop: !!formData.hasCoop,
      isDLI: !!formData.isDLI
    };

    onSave(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-h-[80vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Institution Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor="user_id">Owner User ID</Label>
          <Input
            id="user_id"
            value={formData.user_id}
            onChange={(e) => handleInputChange('user_id', e.target.value)}
            placeholder="Firebase user id"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="city">City *</Label>
          <Input
            id="city"
            value={formData.city}
            onChange={(e) => handleInputChange('city', e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor="province">Province</Label>
          <Select
            value={formData.province || undefined}
            onValueChange={(value) => handleInputChange('province', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select province" />
            </SelectTrigger>
            <SelectContent>
              {PROVINCES.map((province) => (
                <SelectItem key={province.value} value={province.value}>
                  {province.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="country">Country</Label>
          <Input
            id="country"
            value={formData.country}
            onChange={(e) => handleInputChange('country', e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="address">Address</Label>
        <Input
          id="address"
          value={formData.address}
          onChange={(e) => handleInputChange('address', e.target.value)}
          placeholder="Full institution address"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="verification_status">Verification Status</Label>
          <Select
            value={formData.verification_status || undefined}
            onValueChange={(value) => handleInputChange('verification_status', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {VERIFICATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="type">Institution Type</Label>
          <Select
            value={formData.type || undefined}
            onValueChange={(value) => handleInputChange('type', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {INSTITUTION_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="school_level">School Level</Label>
          <Select
            value={formData.school_level || undefined}
            onValueChange={(value) => handleInputChange('school_level', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select school level" />
            </SelectTrigger>
            <SelectContent>
              {SCHOOL_LEVEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label htmlFor="year_established">Year Established</Label>
          <Input
            id="year_established"
            type="number"
            min="1800"
            max="3000"
            value={formData.year_established}
            onChange={(e) => handleInputChange('year_established', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="application_fee">Application Fee</Label>
          <Input
            id="application_fee"
            type="number"
            min="0"
            value={formData.application_fee}
            onChange={(e) => handleInputChange('application_fee', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="cost_of_living">Cost of Living</Label>
          <Input
            id="cost_of_living"
            type="number"
            min="0"
            value={formData.cost_of_living}
            onChange={(e) => handleInputChange('cost_of_living', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="dliNumber">DLI Number</Label>
          <Input
            id="dliNumber"
            value={formData.dliNumber}
            onChange={(e) => handleInputChange('dliNumber', e.target.value)}
            placeholder="e.g. O19312345678"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            type="url"
            value={formData.website}
            onChange={(e) => handleInputChange('website', e.target.value)}
            placeholder="https://..."
          />
        </div>

        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            placeholder="school@example.com"
          />
        </div>

        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={formData.phone}
            onChange={(e) => handleInputChange('phone', e.target.value)}
            placeholder="+1 ..."
          />
        </div>
      </div>

      <div>
        <Label htmlFor="about">About</Label>
        <Textarea
          id="about"
          value={formData.about}
          onChange={(e) => handleInputChange('about', e.target.value)}
          rows={5}
          placeholder="Tell us about this institution..."
        />
      </div>

      <div className="space-y-4">
        <div>
          <Label>Logo</Label>
          <div className="flex flex-wrap items-center gap-4 mt-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
            >
              {uploadingLogo ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload Logo
            </Button>

            {formData.logoUrl && (
              <img
                src={formData.logoUrl}
                alt="Institution logo"
                className="w-20 h-20 object-contain rounded border bg-white"
              />
            )}
          </div>
        </div>

        <div>
          <Label>Banner</Label>
          <div className="flex flex-wrap items-center gap-4 mt-2">
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/*"
              onChange={handleBannerUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => bannerInputRef.current?.click()}
              disabled={uploadingBanner}
            >
              {uploadingBanner ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4 mr-2" />
              )}
              Upload Banner
            </Button>

            {formData.bannerUrl && (
              <img
                src={formData.bannerUrl}
                alt="Institution banner"
                className="w-40 h-24 object-cover rounded border"
              />
            )}
          </div>
        </div>

        <div>
          <Label>Gallery Images</Label>
          <div className="flex flex-wrap items-center gap-4 mt-2">
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleGalleryUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploadingGallery}
            >
              {uploadingGallery ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload Gallery Images
            </Button>
          </div>

          {!!formData.imageUrls.length && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {formData.imageUrls.map((url, index) => (
                <div key={`${url}-${index}`} className="relative border rounded overflow-hidden">
                  <img
                    src={url}
                    alt={`Institution gallery ${index + 1}`}
                    className="w-full h-28 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeGalleryImage(url)}
                    className="absolute top-2 right-2 bg-black/70 text-white rounded-full p-1"
                    aria-label="Remove image"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label htmlFor="popularityScore">Popularity Score</Label>
          <Input
            id="popularityScore"
            type="number"
            min="0"
            max="100"
            value={formData.popularityScore}
            onChange={(e) => handleInputChange('popularityScore', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="rankScore">Rank Score</Label>
          <Input
            id="rankScore"
            type="number"
            min="0"
            max="100"
            value={formData.rankScore}
            onChange={(e) => handleInputChange('rankScore', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="programCount">Program Count</Label>
          <Input
            id="programCount"
            type="number"
            min="0"
            value={formData.programCount}
            onChange={(e) => handleInputChange('programCount', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="avgTuition">Average Tuition</Label>
          <Input
            id="avgTuition"
            type="number"
            min="0"
            value={formData.avgTuition}
            onChange={(e) => handleInputChange('avgTuition', e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="tags">Tags (comma separated)</Label>
        <Input
          id="tags"
          value={formData.tags}
          onChange={(e) => handleInputChange('tags', e.target.value)}
          placeholder="e.g. research, technology, arts"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isFeatured"
            checked={!!formData.isFeatured}
            onCheckedChange={(checked) => handleInputChange('isFeatured', !!checked)}
          />
          <Label htmlFor="isFeatured">Featured Institution</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="isPublic"
            checked={!!formData.isPublic}
            onCheckedChange={(checked) => handleInputChange('isPublic', !!checked)}
          />
          <Label htmlFor="isPublic">Public Institution</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="hasCoop"
            checked={!!formData.hasCoop}
            onCheckedChange={(checked) => handleInputChange('hasCoop', !!checked)}
          />
          <Label htmlFor="hasCoop">Has Co-op Programs</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="isDLI"
            checked={!!formData.isDLI}
            onCheckedChange={(checked) => handleInputChange('isDLI', !!checked)}
          />
          <Label htmlFor="isDLI">Designated Learning Institution</Label>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          Save Institution
        </Button>
      </div>
    </form>
  );
}